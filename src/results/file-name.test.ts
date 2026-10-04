import { describe, expect, it } from "vitest";
import { fileSafe } from "../util.js";
import { CSV_FALLBACK, downloadName, ZIP_FALLBACK } from "./file-name.js";

/** A character by its number, so that none of the invisible ones stands in this file itself. */
const char = (code: number): string => String.fromCodePoint(code);
const zip = (name: unknown) => downloadName(name, ".zip", ZIP_FALLBACK);
const csv = (name: unknown) => downloadName(name, ".csv", CSV_FALLBACK);

describe("The names the results page gives its downloads", () => {
  it("takes a plain file name with the expected ending as it is", () => {
    const names = ["Demo app - App Export - 2026-10-03.zip", "Model one - Model Export - 2026-10-03.zip", "a.zip", "Q4 (final) v2.1 [draft] & more.zip",
      "Vertrieb Süd — Übersicht.zip", "販売計画.zip", "تخطيط المبيعات.zip", "name with  two spaces.zip", "trailing dot..zip", "100% 'quoted' + #1.zip"];
    expect(names.map(zip)).toEqual(names);
    const files = ["Cards.csv", "Line Items.csv", "Conditional Formatting.csv", "Import Data Sources.csv", "Übersicht.csv"];
    expect(files.map(csv)).toEqual(files);
    // The name the analysis makes of an app's or a model's name is such a name, whatever was typed into it.
    for (const typed of ["Sales / Margin: Q4?", "evil\\..\\..", `tab${char(9)}and${char(10)}break`, "<script>alert(1)</script>", "", "   "]) {
      const made = `${fileSafe(typed, "app")} - App Export - 2026-10-03.zip`;
      expect(zip(made), typed).toBe(made);
    }
    // The one exception: the analysis keeps a dot a name begins with, and a file that begins with a dot is a hidden one.
    expect(zip(`${fileSafe("..\\..\\evil", "app")} - App Export - 2026-10-03.zip`)).toBe("Cardigan export.zip");
  });

  it("gives the fixed name for a name that is a path", () => {
    for (const name of ["..\\..\\evil.zip", "../../evil.zip", "..\\evil.zip", "/etc/evil.zip", "C:\\Users\\evil.zip", "folder/evil.zip", "folder\\evil.zip", "C:evil.zip", "\\\\server\\share\\evil.zip"]) {
      expect(zip(name), name).toBe("Cardigan export.zip");
    }
    for (const name of ["..\\..\\evil.csv", "../../evil.csv", "sub/Cards.csv", "sub\\Cards.csv"]) expect(csv(name), name).toBe("table.csv");
  });

  it("gives the fixed name for a name with a character that sets the direction of the text, or one that cannot be seen to end a line", () => {
    // A right-to-left override makes "evil" + override + "piz.exe" read as "evilexe.zip", and "exe" + override + "fdp.zip" read as a PDF.
    const override = char(0x202e);
    expect([zip(`evil${override}piz.exe`), zip(`exe${override}fdp.zip`), csv(`Cards${override}vsc.csv`), csv(`${override}Cards.csv`)]).toEqual([ZIP_FALLBACK, ZIP_FALLBACK, CSV_FALLBACK, CSV_FALLBACK]);
    // Every such character: the marks, the embeddings and overrides, the isolates.
    for (const code of [0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]) {
      expect(zip(`na${char(code)}me.zip`), code.toString(16)).toBe(ZIP_FALLBACK);
    }
    // Control characters, and the two separators that end a line or a paragraph.
    for (const code of [0x00, 0x01, 0x09, 0x0a, 0x0d, 0x1b, 0x1f, 0x7f, 0x80, 0x9f, 0x2028, 0x2029]) {
      expect(zip(`na${char(code)}me.zip`), code.toString(16)).toBe(ZIP_FALLBACK);
      expect(csv(`name.csv${char(code)}`), code.toString(16)).toBe(CSV_FALLBACK);
    }
    // Letters that are written from right to left are letters, not such a character.
    expect(zip("שלום.zip")).toBe("שלום.zip");
  });

  it("gives the fixed name for a name with another ending, a leading dot, a character a file name cannot hold, or no name at all", () => {
    for (const name of ["evil.exe", "evil.zip.exe", "evil.ZIP", "evil.zip ", "evil", "evil.csv", ".zip", "", ".hidden.zip", "..zip", "a:b.zip", "a*b.zip", "what?.zip",
      "\"quoted\".zip", "a<b>.zip", "a|b.zip", 42, null, undefined, {}, ["a.zip"], { toString: () => "a.zip" }]) {
      expect(zip(name), JSON.stringify(name)).toBe("Cardigan export.zip");
    }
    for (const name of ["Cards.zip", "Cards.csv.exe", "Cards.CSV", ".csv", ".Cards.csv", "Cards", 7, undefined]) expect(csv(name), JSON.stringify(name)).toBe("table.csv");
  });

  it("has fixed names that are themselves plain", () => {
    expect([zip(ZIP_FALLBACK), csv(CSV_FALLBACK)]).toEqual(["Cardigan export.zip", "table.csv"]);
  });
});
