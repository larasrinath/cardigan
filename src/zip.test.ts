import { describe, expect, it } from "vitest";
import { crc32, safeCell, toCsv, zipStore } from "./zip.js";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("Page analyzer CSV and zip output", () => {
  it("computes the standard CRC-32 check value", () => {
    expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it("writes a stored zip whose central directory points at each entry", () => {
    const files = [{ name: "a.csv", data: bytes("x,y\r\n") }, { name: "é.txt", data: new Uint8Array() }];
    const zip = zipStore(files, new Date(2026, 8, 27, 12, 30, 10));
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const end = zip.byteLength - 22;
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect([view.getUint16(end + 8, true), view.getUint16(end + 10, true)]).toEqual([2, 2]);
    const central = view.getUint32(end + 16, true);
    expect(view.getUint32(central, true)).toBe(0x02014b50);
    expect(view.getUint32(central + 16, true)).toBe(crc32(files[0].data));
    expect(view.getUint32(central + 42, true)).toBe(0);
    const secondLocal = 30 + 5 + files[0].data.byteLength;
    expect(view.getUint32(secondLocal, true)).toBe(0x04034b50);
    const secondCentral = central + 46 + 5;
    expect(view.getUint32(secondCentral + 42, true)).toBe(secondLocal);
    expect(view.getUint16(secondCentral + 8, true)).toBe(0x0800); // UTF-8 names
    expect(new TextDecoder().decode(zip.subarray(secondCentral + 46, secondCentral + 46 + view.getUint16(secondCentral + 28, true)))).toBe("é.txt");
    expect(view.getUint32(end + 12, true)).toBe(end - central);
  });

  it("quotes cells, adds a byte order mark and keeps formula-like text as text", () => {
    expect(toCsv(["A", "B"], [["=SUM(1)", 'say "hi", ok'], [3, "line\nbreak"]]))
      .toBe('\ufeffA,B\r\n\'=SUM(1),"say ""hi"", ok"\r\n3,line / break\r\n');
    expect([safeCell("-10 → #F5A5B1"), safeCell("+cmd"), safeCell("@x"), safeCell("-1+1"), safeCell(0), safeCell(undefined)])
      .toEqual(["'-10 → #F5A5B1", "'+cmd", "'@x", "'-1+1", "0", ""]);
    // A plain number cannot be a formula, so it keeps its sign without an apostrophe showing in Excel.
    expect([safeCell("-1"), safeCell("+2"), safeCell("-0.5"), safeCell(-3)]).toEqual(["-1", "+2", "-0.5", "-3"]);
  });

  it("keeps IDs of 12 or more digits as text, so Excel shows them in full rather than as 1.476E+12", () => {
    expect([safeCell("1476000000012"), safeCell(102000000086), safeCell("20000000012"), safeCell("102000000086; 102000000087")])
      .toEqual(['="1476000000012"', '="102000000086"', "20000000012", "102000000086; 102000000087"]);
    expect(toCsv(["Line item ID"], [["1476000000012"]])).toBe('\ufeffLine item ID\r\n"=""1476000000012"""\r\n');
  });
});
