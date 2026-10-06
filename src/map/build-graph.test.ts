import { describe, expect, it } from "vitest";
import { definitionOf, idOf, integer, knownSequence, separator, splitOutside, stripChars, unquote } from "./graph-names.js";

// Made-up names only: nothing here comes from a real model.

describe("The names in a cell of a model export", () => {
  it("takes a row for a heading when its name starts with two dashes or is nothing but spaces, dots and dashes", () => {
    for (const name of ["-- MODEL ADMIN", "--- 01 : INPUTS ---", "--", "------", "-", "", " ", ". . . .", "- - -", " .-. "]) expect(separator(name), JSON.stringify(name)).toBe(true);
    // One dash and a name is a name, and so is a row of other strokes.
    for (const name of ["Revenue", "- Notes", "REV01 -- Revenue", " -- Indented", "======", "\u2014\u2014 Inputs \u2014\u2014", "_____"]) expect(separator(name), JSON.stringify(name)).toBe(false);
    expect([stripChars("-- 01 : INPUTS --", " -"), stripChars("------", " -"), stripChars("_101000000007_", "_"), stripChars("a-b", "-"), stripChars("", "-")])
      .toEqual(["01 : INPUTS", "", "101000000007", "a-b", ""]);
  });

  it("takes a name out of its single quotes, where two single quotes are one of the name's own", () => {
    expect(["Revenue", "'REV01 Revenue, net'", "'It''s a ''plan'''", " 'Padded' ", "''", "'a'b'"].map(unquote)).toEqual(["Revenue", "REV01 Revenue, net", "It's a 'plan'", "Padded", "", "a'b"]);
    // A quote at one end only is part of the name, and one quote alone is a name.
    expect(["'Unclosed", "Closed only'", "'", "It's"].map(unquote)).toEqual(["'Unclosed", "Closed only'", "'", "It's"]);
  });

  it("splits a cell of names only outside single quotes, and leaves out an empty part and a dash", () => {
    expect(splitOutside("Products, 'Regions, north & south',Channels")).toEqual(["Products", "'Regions, north & south'", "Channels"]);
    // Two single quotes inside a quoted name end nothing: the comma after them is still inside.
    expect(splitOutside("'It''s, here', 'O''Brien''s', x")).toEqual(["'It''s, here'", "'O''Brien''s'", "x"]);
    expect([splitOutside(""), splitOutside("-"), splitOutside(" - ,, -, Products , ")]).toEqual([[], [], ["Products"]]);
    // A quote that is never closed keeps the rest of the cell together.
    expect(splitOutside("Products, 'Regions, north, Channels")).toEqual(["Products", "'Regions, north, Channels"]);
    // A line item behind its module: the same split at a dot, where a dot inside quotes is part of a name.
    expect(splitOutside("'Plan v1.2'.'Rate, net (50%)'", ".")).toEqual(["'Plan v1.2'", "'Rate, net (50%)'"]);
    expect([splitOutside("REV01 Revenue.Units", "."), splitOutside("Units", "."), splitOutside("A..B", "."), splitOutside("A.-", "."), splitOutside(".", ".")])
      .toEqual([["REV01 Revenue", "Units"], ["Units"], ["A", "B"], ["A"], []]);
  });

  it("finds the known names in a cell that writes them without quotes, the longest first, and takes what is left for names as written", () => {
    const known = new Set(["Nightly load", "Nightly load, full", "Weekly"]);
    const longest = "Nightly load, full".length;
    const sequence = (text: string): string[] => knownSequence(text, known, longest);
    expect(sequence("Nightly load, Nightly load, full, Weekly")).toEqual(["Nightly load", "Nightly load, full", "Weekly"]);
    expect([sequence("Nightly load, full"), sequence("Nightly load"), sequence(" Weekly "), sequence("")]).toEqual([["Nightly load, full"], ["Nightly load"], ["Weekly"], []]);
    // A name that is not known ends at the next comma and space, and is given as it is written.
    expect(sequence("Gone, Weekly, Old, load")).toEqual(["Gone", "Weekly", "Old", "load"]);
    // A known name counts only where it ends at the cell's end or before a comma and a space.
    expect([sequence("Weekly load"), sequence("Weekly,Nightly load"), sequence("Weekly,  Weekly")]).toEqual([["Weekly load"], ["Weekly,Nightly load"], ["Weekly", "Weekly"]]);
    // Without known names every part is a name as written, and an empty part is one too: the caller finds it matches nothing.
    expect(knownSequence("a, , b", new Set(), 0)).toEqual(["a", "", "b"]);
  });

  it("reads a count, a definition and an ID, and nothing from a cell that holds none", () => {
    expect(["12", "1,234,567", " 40 ", "-3", "+7", "0", "-0"].map(integer)).toEqual([12, 1234567, 40, -3, 7, 0, 0]);
    expect(["", "12.5", "n/a", "1e3", "12 cells", "9007199254740993"].map(integer)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
    expect([definitionOf('{"dataType":"NUMBER"}'), definitionOf(' {"a":{"b":1}}')]).toEqual([{ dataType: "NUMBER" }, { a: { b: 1 } }]);
    // JSON that is no object is no definition, and neither is text that only starts as one.
    for (const text of ["", "Number", "[1,2]", '"TEXT"', "42", "null", "true", '{"dataType":"NUMB', "{not json}"]) expect(definitionOf(text), text).toBeUndefined();
    expect([101000000007, "101000000007", "_101000000007_"].map(idOf)).toEqual(["101000000007", "101000000007", "101000000007"]);
    for (const value of [-1, 1.5, 2 ** 60, "Products", "", " 101000000007 ", null, undefined, [101000000007], {}]) expect(idOf(value), JSON.stringify(value)).toBeUndefined();
  });
});
