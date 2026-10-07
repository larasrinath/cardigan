import { crc32 } from "./crc32.js";

/** A result as files: each table as CSV text, and the files in a store-only (uncompressed) zip archive, with what reads
 * both back. Tests only. Cardigan wrote these files for download through version 0.9.1, and versions 0.6.1 and 0.8.1
 * are kept as the zips they wrote (golden-0.6.1.test-support.ts, golden-0.8.1.test-support.ts). The tests go on writing
 * a result the same way, to hold what the engine makes today against those zips byte for byte. The extension itself
 * writes no file: nothing but a test loads this module, and no bundle holds it. */

/* ---------- writing ---------- */

/** Spreadsheets treat a leading = + - @ as a formula; a leading apostrophe keeps the cell as text. A plain number such as -1
 * cannot be a formula, so it keeps its sign without the apostrophe. Excel also shows a number of 12 or more digits, such as
 * an Anaplan line item ID, as 1.476E+12, so those are written as a formula that is only that text: Excel shows every digit. */
export function safeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value).replace(/\r\n?|\n/g, " / ");
  if (/^\d{12,}$/.test(text)) return `="${text}"`;
  if (/^[=+\-@]/.test(text) && !/^[+-]?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return text;
}

/** RFC 4180 CSV with a UTF-8 byte order mark, so Excel reads non-ASCII names correctly. The page analysis guards formula-like
 * cells; the model export writes values exactly as Anaplan's own export does (`guard` false), line breaks included. */
export function toCsv(headers: readonly string[], rows: readonly (readonly unknown[])[], guard = true): string {
  const quote = (value: unknown) => {
    const text = guard ? safeCell(value) : value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `\ufeff${[headers, ...rows].map(row => row.map(quote).join(",")).join("\r\n")}\r\n`;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export interface ZipEntry { name: string; data: Uint8Array }

export function zipStore(entries: readonly ZipEntry[], modified = new Date()): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(modified);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.byteLength;
    const local = new Uint8Array(30 + name.byteLength);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.byteLength, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.byteLength);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.byteLength, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local, entry.data);
    centrals.push(central);
    offset += local.byteLength + size;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.byteLength, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, end];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.byteLength; }
  return out;
}

/* ---------- reading back ---------- */

/** True when two files are the same, byte for byte. */
export const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.byteLength === b.byteLength && a.every((byte, index) => byte === b[index]);

/** Each file in a stored (uncompressed) zip as zipStore writes it, in the zip's order, with its bytes. */
export function zipEntries(zip: Uint8Array): { name: string; data: Uint8Array }[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const decoder = new TextDecoder();
  const entries: { name: string; data: Uint8Array }[] = [];
  let offset = 0;
  while (offset + 30 <= zip.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const start = offset + 30 + nameLength + view.getUint16(offset + 28, true);
    entries.push({ name: decoder.decode(zip.subarray(offset + 30, offset + 30 + nameLength)), data: zip.subarray(start, start + size) });
    offset = start + size;
  }
  return entries;
}

/** Each of those files by name, as text. */
export function unzipText(zip: Uint8Array): Map<string, string> {
  const decoder = new TextDecoder();
  return new Map(zipEntries(zip).map(({ name, data }) => [name, decoder.decode(data)]));
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
