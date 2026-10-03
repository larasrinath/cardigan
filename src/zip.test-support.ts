/** Reads back what the analyzer writes, so a test can check a file inside an export rather than only the summary.
 * Tests only. */

/** True when two files are the same, byte for byte. */
export const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.byteLength === b.byteLength && a.every((byte, index) => byte === b[index]);

/** Each file in a stored (uncompressed) zip as zipStore writes it, by name, as text. */
export function unzipText(zip: Uint8Array): Map<string, string> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const decoder = new TextDecoder();
  const files = new Map<string, string>();
  let offset = 0;
  while (offset + 30 <= zip.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const start = offset + 30 + nameLength + view.getUint16(offset + 28, true);
    files.set(decoder.decode(zip.subarray(offset + 30, offset + 30 + nameLength)), decoder.decode(zip.subarray(start, start + size)));
    offset = start + size;
  }
  return files;
}

/** A CSV as toCsv writes it (optional byte order mark, CRLF rows, quoted cells with doubled quotes), as rows of cells. */
export function parseCsv(text: string): string[][] {
  const body = text.replace(/^\ufeff/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < body.length; index++) {
    const char = body[index];
    if (quoted) {
      if (char === "\"" && body[index + 1] === "\"") { cell += "\""; index++; } else if (char === "\"") quoted = false; else cell += char;
    } else if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\r" && body[index + 1] === "\n") {
      rows.push([...row, cell]);
      row = [];
      cell = "";
      index++;
    } else {
      cell += char;
    }
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}
