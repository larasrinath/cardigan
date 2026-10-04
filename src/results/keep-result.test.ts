import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalysisResult, Cell } from "../result-types.js";
import { resultZip } from "../result-zip.js";
import { VERSION } from "../version.js";
import { bytesToText, KEPT_PREFIX, MAX_JSON_BYTES, MAX_PACKED_BYTES, PART_CHARS, ResultKeeper, textToBytes, type KeeperOptions, type KeptStorage } from "./keep-result.js";

/** A character by its number, so that none of the invisible ones, and no half of a surrogate pair, stands in this file. */
const char = (code: number): string => String.fromCharCode(code);

/** What a browser throws when a write would take the storage over its room. */
const full = (key: string): DOMException => new DOMException(`Failed to execute 'setItem' on 'Storage': Setting the value of '${key}' exceeded the quota.`, "QuotaExceededError");

/** A tab's session storage. It counts its room in characters, of keys and values alike, which is how Chrome is understood
 * to count it, and it remembers every key a write or a removal named. */
class FakeStorage implements KeptStorage {
  private readonly items = new Map<string, string>();
  /** Every key `setItem` and `removeItem` were called with, in order. */
  readonly touched: string[] = [];
  /** How many characters fit. */
  room = Infinity;
  /** The write, counted from 1, that throws `error` whatever its size. */
  failing: { write: number; error: unknown } | undefined;
  writes = 0;
  constructor(items: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(items)) this.items.set(key, value);
  }
  get length(): number { return this.items.size; }
  key(index: number): string | null { return [...this.items.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.items.get(key) ?? null; }
  setItem(key: string, value: string): void {
    this.touched.push(key);
    this.writes++;
    if (this.failing?.write === this.writes) throw this.failing.error;
    const old = this.items.get(key);
    if (this.chars() - (old === undefined ? 0 : key.length + old.length) + key.length + value.length > this.room) throw full(key);
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.touched.push(key);
    this.items.delete(key);
  }
  /** The characters it holds, keys included. */
  chars(): number {
    let sum = 0;
    for (const [key, value] of this.items) sum += key.length + value.length;
    return sum;
  }
  keys(): string[] { return [...this.items.keys()]; }
  /** What it holds, to look at or to put into another storage. */
  entries(): Record<string, string> { return Object.fromEntries(this.items); }
  /** Changes what a key holds behind the module's back, as nothing in the page does: a damaged or a made-up value. */
  put(key: string, value: string | undefined): void {
    if (value === undefined) this.items.delete(key); else this.items.set(key, value);
  }
}

const TAB = 4521;
const RELEASE = "0.7.0";
/** When the result was complete, to the millisecond. */
const AT = new Date(Date.UTC(2026, 9, 3, 14, 2, 5, 678));
const HEAD = `${KEPT_PREFIX}head`;
const part = (index: number): string => `${KEPT_PREFIX}${index}`;
/** The keys of the module's a storage holds. */
const kept = (storage: FakeStorage): string[] => storage.keys().filter(key => key.startsWith(KEPT_PREFIX));

/** The page's keeper over a tab's storage. A refresh starts the page anew over the same storage: a new keeper. */
const page = (storage: KeptStorage, options: Partial<KeeperOptions> = {}): ResultKeeper => new ResultKeeper({ tabId: TAB, version: RELEASE, storage, ...options });

/** gzip as the browser's stream writes it, for a test that decides what the parts hold or when compressing ends. */
const gzipped = (bytes: Uint8Array | string): Uint8Array => new Uint8Array(gzipSync(bytes));
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
/** Whether two runs of bytes are the same. `toEqual` says where two runs differ, which takes it seconds on megabytes. */
const sameBytes = (a: Uint8Array | undefined, b: Uint8Array | undefined): boolean => !!a && !!b && a.length === b.length && a.every((byte, index) => byte === b[index]);

/** An app's result as the analysis lays one out, with fewer columns: numbers and texts, the dash for nothing to say, and
 * names as people type them. */
const APP: AnalysisResult = {
  kind: "app", name: "Demo app — planning", id: "01234567-89ab-cdef-0123-456789abcdef", zipName: "Demo app - App Export - 2026-10-03.zip",
  summary: ["2 of 2 pages analysed, 4 cards.", "1 model did not answer."],
  tables: [
    { file: "App Details.csv", label: "App Details", headers: ["Section", "Detail", "Value"], guard: true, details: true,
      rows: [["App", "App", "Demo app — planning"], ["Export", "Anaplan host", "us1a.app.anaplan.com"], ["Diagnostics", "14:02:05", "app: 2 pages"]] },
    { file: "Pages.csv", label: "Pages", headers: ["App", "Page", "Total cards", "Page ID"], guard: true,
      rows: [["Demo app — planning", "Overview", 2, "page-1"], ["Demo app — planning", "Übersicht (copy)", 2, "page-2"]] },
    { file: "Cards.csv", label: "Cards", headers: ["Page", "Card #", "Card title", "Card type", "Card ID"], guard: true,
      rows: [["Overview", 1, "Sales", "Grid", "card-a"], ["Overview", 2, "=Margin", "KPI", "card-b"], ["Übersicht (copy)", 1, "—", "Grid", "card-a"], ["Übersicht (copy)", 2, "販売計画", "KPI", "card-b"]] },
    { file: "Filters.csv", label: "Filters", headers: ["Page", "Card #"], rows: [], guard: true },
    { file: "Where Used.csv", label: "Where Used", headers: ["Object type", "Object name", "Page", "Card #", "Object ID"], guard: true,
      rows: [["Module", "REP01 Sales", "Overview", 1, "102000000001"], ["Line item", "Margin %", "Übersicht (copy)", 2, 0.125]] },
  ],
};

/** Numbers from a seed, the same on every run: the made-up model below is the same model each time. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ["Revenue", "Volume", "Price", "Cost", "Margin", "Headcount", "Salary", "Bonus", "Tax", "Discount", "Rebate", "Forecast", "Actual", "Budget", "Target",
  "Variance", "Opening", "Closing", "Balance", "Inventory", "Demand", "Supply", "Capacity", "Shipment", "Order", "Backlog", "Rate", "Driver", "Allocation", "Depreciation",
  "Capex", "Opex", "Accrual", "Commission", "Quota", "Territory", "Seasonality", "Baseline", "Uplift", "Promotion", "Churn", "Renewal", "Bookings", "Billings", "Cash",
  "Receivable", "Payable", "Exchange", "Index", "Share", "Growth", "Adjustment", "Override", "Final", "Prior Year", "Year to Date", "Plan", "Scenario", "Lead Time", "Safety Stock"];
const AREAS = ["SYS", "DAT", "REV", "EXP", "HC", "INV", "SUP", "DEM", "REP", "CAP", "FIN", "ALL", "MAP", "ADM"];
const LISTS = ["Products", "Regions", "Customers", "Cost Centres", "Employees", "Accounts", "Channels", "SKUs", "Plants", "Projects", "Currencies", "Legal Entities",
  "Brands", "Suppliers", "Warehouses", "Routes", "Job Grades", "Contracts"];
const number = (places: number, units: string): string => `{"minimumSignificantDigits":-1,"decimalPlaces":${places},"decimalSeparator":"FULL_STOP","groupingSeparator":"COMMA",`
  + `"negativeNumberNotation":"MINUS_SIGN","unitsType":"${units}","unitsDisplayType":"NONE","currencyCode":null,"customUnits":null,"zeroFormat":"ZERO","comparisonIncrease":"GOOD","dataType":"NUMBER"}`;
const summary = (method: string, numerator = "", denominator = ""): string =>
  `{"summaryMethod":"${method}","timeSummaryMethod":"${method}","timeSummarySameAsMainSummary":true,"ratioNumeratorIdentifier":"${numerator}","ratioDenominatorIdentifier":"${denominator}"}`;
/** The Line Items file's 27 columns: the unnamed one that names each row, the grid's own, and the export's two for a ratio. */
const LINE_HEADERS = ["", "Parent", "Is Summary", "Formula", "Format", "Applies To", "Time Scale", "Time Range", "Versions", "Summary", "Formula Scope", "Style", "Brought Forward",
  "Start of Section", "Read Access Driver", "Write Access Driver", "Use Switchover", "Breakback", "Data Tags", "Referenced By", "Notes", "Code", "Cell Count",
  "Populated Cell Count", "Calculation Effort", "Ratio Numerator", "Ratio Denominator"];
const PER_MODULE = 25;

/** A made-up model as the model export lays one out, every cell a text: Model Details, a Line Items file of 27 columns
 * in which each module's row stands above its 25 line items, and smaller files. Formulas name line items of their own
 * module and of others, a few of them at length; formats and summaries are the JSON a grid holds. Nothing in it comes from
 * a real model. */
function madeUpModel(lineItems: number): AnalysisResult {
  const random = seeded(20261003);
  const upTo = (count: number): number => Math.floor(random() * count);
  const pick = <T>(from: readonly T[]): T => from[upTo(from.length)];
  const words = (count: number): string => Array.from({ length: count }, () => pick(WORDS)).join(" ");
  const modules = Array.from({ length: Math.ceil(lineItems / PER_MODULE) }, (_, index) => `${pick(AREAS)}${String(index + 1).padStart(3, "0")} ${words(1 + upTo(3))}`);
  const names = modules.map(() => Array.from({ length: PER_MODULE }, () => `${words(1 + upTo(4))}${pick(["", "", "", " %", " (LC)", " Override", " Final"])}`));
  const yes = (chance: number): string => (random() < chance ? "true" : "false");
  const lines: Cell[][] = [];
  const moduleRows: Cell[][] = [];
  modules.forEach((module, index) => {
    const applies = [...new Set(Array.from({ length: 1 + upTo(4) }, () => pick(LISTS)))].join(", ");
    const elsewhere = (): string => {
      const other = upTo(modules.length);
      return `'${modules[other]}'.'${pick(names[other])}'`;
    };
    const term = (): string => (random() < 0.6 ? `'${pick(names[index])}'` : elsewhere());
    const formula = (): string => {
      switch (upTo(9)) {
        case 0: return "";
        case 1: return `${term()} * ${term()}`;
        case 2: return `IF ${term()} > 0 THEN ${term()} / ${term()} ELSE 0`;
        case 3: return `${elsewhere()}[LOOKUP: ${term()}]`;
        case 4: return `${elsewhere()}[SUM: ${elsewhere()}, LOOKUP: ${term()}]`;
        case 5: return `IF ISBLANK(${term()}) THEN PREVIOUS(${term()}) ELSE ${term()} + ${term()} - ${term()}`;
        case 6: return `ROUND(${term()} * (1 + ${term()}), ${upTo(4)})`;
        case 7: return `TIMESUM(${term()}, ${elsewhere()}, ${elsewhere()})`;
        // A long one: a choice between several cases, each with its own sum.
        default: return `${Array.from({ length: 3 + upTo(8) }, () => `IF ${term()} = ${pick(LISTS)}.'${words(2)}' THEN ${term()} * ${elsewhere()}[SUM: ${elsewhere()}] ELSE `).join("")}0`;
      }
    };
    const cells = String(upTo(50_000_000));
    lines.push([module, "", "", "", "", applies, "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", cells, "", "", "", ""]);
    moduleRows.push([module, applies, cells, pick(["Sales", "Finance", "Supply chain", "Workforce", ""]), random() < 0.3 ? `${words(6)}.` : ""]);
    for (const name of names[index]) {
      const ratio = random() < 0.08;
      const kind = upTo(10);
      const format = kind < 6 ? number(pick([0, 0, 1, 2, 4]), pick(["NONE", "NONE", "PERCENTAGE", "CURRENCY"])) : kind < 7 ? '{"dataType":"BOOLEAN"}' : kind < 8 ? '{"textType":"GENERAL","dataType":"TEXT"}'
        : `{"hierarchyEntityLongId":${101000000000 + upTo(LISTS.length)},"entityFormatFilter":null,"dataType":"ENTITY"}`;
      lines.push([
        name, random() < 0.1 ? pick(names[index]) : "", yes(0.1), formula(), format, random() < 0.7 ? "-" : applies, pick(["Month", "Month", "Not Applicable", "Year", "Week"]),
        pick(["Model Calendar", "Model Calendar", "FY26 only", "Actuals years"]), pick(["All", "All", "Actual", "Not Applicable"]),
        ratio ? summary("RATIO", `_${290000000000 + upTo(lineItems)}_`, `_${290000000000 + upTo(lineItems)}_`) : summary(pick(["SUM", "SUM", "SUM", "NONE", "FORMULA", "AVERAGE", "CLOSING_BALANCE"])),
        pick(["All Versions", "All Versions", "Actual Version", "Current Version"]), pick(["Normal", "Normal", "Normal", "Heading 1", "Heading 2"]), yes(0.02), yes(0.05),
        random() < 0.1 ? elsewhere() : "", random() < 0.1 ? elsewhere() : "", yes(0.05), yes(0.03), random() < 0.1 ? pick(["Input", "Reporting", "Calculation", "To review"]) : "",
        Array.from({ length: upTo(6) }, elsewhere).join(", "), random() < 0.2 ? `${words(5 + upTo(20))}.` : "", random() < 0.1 ? `LI${upTo(100000)}` : "",
        String(upTo(50_000_000)), String(upTo(1_000_000)), String(upTo(100)), ratio ? pick(names[index]) : "", ratio ? pick(names[index]) : "",
      ]);
    }
  });
  const few = (file: string, headers: string[], rows: Cell[][]) => ({ file: `${file}.csv`, label: file, headers, rows, guard: false });
  const tables = [
    few("Line Items", LINE_HEADERS, lines),
    few("Modules", ["", "Applies To", "Cell Count", "Functional Area", "Notes"], moduleRows),
    few("General Lists", ["", "Top Level Item", "Parent Hierarchy", "Workflow", "Numbered List"], LISTS.map(list => [list, `All ${list}`, "", "false", yes(0.2)])),
    few("Processes", ["", "Notes", "Last Run"], Array.from({ length: 12 }, (_, index) => [`P${index + 1} ${words(3)}`, "", "2026-10-02 23:10:04"])),
    few("Imports", ["", "Source Label", "Target Object", "Target Type"], Array.from({ length: 40 }, () => [`Import ${words(3)}`, `${words(2)}.csv`, pick(modules), "Module"])),
    few("Versions", ["", "Is Actual", "Switchover"], [["Actual", "true", ""], ["Forecast", "false", "Oct 26"], ["Budget", "false", "Jan 27"]]),
  ];
  return {
    kind: "model", name: "Planning model one", id: "0123456789ABCDEF0123456789ABCDEF", zipName: "Planning model one - Model Export - 2026-10-03.zip",
    summary: tables.map(table => `${table.label}: ${table.rows.length} rows`),
    tables: [
      { file: "Model Details.csv", label: "Model Details", headers: ["Section", "Detail", "Value"], guard: true, details: true, rows: [
        ["Model", "Model", "Planning model one"], ["Model", "Workspace", "Made-up workspace"], ["Export", "Anaplan host", "us1a.app.anaplan.com"],
        ...tables.map((table): Cell[] => ["Files", table.file, `${table.rows.length} rows`]),
        ...Array.from({ length: Math.ceil(lines.length / 200) }, (_, index): Cell[] => ["Diagnostics", "09:30:00", `Line Items: rows ${index * 200 + 1} to ${Math.min(lines.length, (index + 1) * 200)}`]),
      ] },
      ...tables,
    ],
  };
}

/** The model the sizes are measured on: 5,000 line items under 200 modules, 5,200 rows of 27 columns. Built once. */
let model: AnalysisResult | undefined;
const largeModel = (): AnalysisResult => (model ??= madeUpModel(5000));

/** A result of text that hardly compresses, about `chars` characters of it: one that takes several parts without being large. */
function noisy(chars: number): AnalysisResult {
  const random = seeded(chars);
  const rows: Cell[][] = Array.from({ length: Math.ceil(chars / 1000) }, (_, index) => [index, Array.from({ length: 100 }, () => Math.floor(random() * 2 ** 50).toString(36).padStart(10, "0")).join("")]);
  return { ...APP, name: "Noise", tables: [APP.tables[0], { file: "Noise.csv", label: "Noise", headers: ["#", "Text"], rows, guard: true }] };
}

/** One such result, built once. Its 750,000 characters compress to some 480,000 bytes: three parts, and the head. */
const NOISE = noisy(750_000);

const copy = <T>(value: T): T => structuredClone(value);
const lastCell = (result: AnalysisResult): Cell | undefined => result.tables.at(-1)?.rows.at(-1)?.at(-1);

afterEach(() => { vi.unstubAllGlobals(); });

describe("Bytes as text for the session storage", () => {
  /** Bytes that are not all alike: every value, in an order that does not repeat with the 15 bits. */
  const run = (length: number, seed = 1): Uint8Array => Uint8Array.from({ length }, (_, index) => (index * 151 + seed * 37) & 0xff);

  it("gives back every run of bytes as it was, whatever its length", () => {
    for (let length = 0; length <= 64; length++) {
      for (const bytes of [run(length), run(length, 7), new Uint8Array(length), new Uint8Array(length).fill(0xff)]) {
        const text = bytesToText(bytes);
        expect(text.length, String(length)).toBe(Math.ceil((length * 8) / 15));
        expect(textToBytes(text, length), String(length)).toEqual(bytes);
      }
    }
    // More than String.fromCharCode is handed at once, and a length that leaves bits over.
    const long = run(100_003);
    expect(sameBytes(textToBytes(bytesToText(long), long.length), long)).toBe(true);
  });

  it("writes 15 bits to a character, high bit first, with the bits left over as zeros", () => {
    expect([...bytesToText(Uint8Array.of(0xff, 0xff))].map(letter => letter.charCodeAt(0))).toEqual([0x4e00 + 0x7fff, 0x4e00 + 0x4000]);
    expect([...bytesToText(Uint8Array.of(0x80, 0x01, 0xc0))].map(letter => letter.charCodeAt(0))).toEqual([0x4e00 + 0x4000, 0x4e00 + 0x7000]);
    expect(bytesToText(new Uint8Array(0))).toBe("");
    // 15 bytes are 8 characters exactly; base64 would take 20.
    expect(bytesToText(run(15)).length).toBe(8);
  });

  it("uses only the 32,768 characters from U+4E00 to U+CDFF: no control character and no half of a surrogate pair", () => {
    const text = bytesToText(run(70_000));
    const codes = [...new Set(Array.from({ length: text.length }, (_, index) => text.charCodeAt(index)))];
    expect(Math.min(...codes)).toBeGreaterThanOrEqual(0x4e00);
    expect(Math.max(...codes)).toBeLessThanOrEqual(0xcdff);
    // Both ends of the range are used: 15 bits of zeros, and 15 bits of ones.
    expect([bytesToText(new Uint8Array(15)), bytesToText(new Uint8Array(15).fill(0xff))]).toEqual([char(0x4e00).repeat(8), char(0xcdff).repeat(8)]);
  });

  it("gives nothing for a text that is not the text of that many bytes", () => {
    const bytes = run(40);
    const text = bytesToText(bytes);
    expect(textToBytes(text, 40)).toEqual(bytes);
    // Another length: of the text, or of the bytes asked for.
    for (const other of [text.slice(1), text.slice(0, -1), `${text}${char(0x4e00)}`, ""]) expect(textToBytes(other, 40)).toBeUndefined();
    for (const length of [39, 42, 0, -1, 40.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(textToBytes(text, length), String(length)).toBeUndefined();
    // 41 bytes take 22 characters as 40 do, so this text is also the text of these 40 bytes and a zero. The text alone does
    // not say how many bytes it holds: the head does, with their checksum.
    expect(textToBytes(text, 41)).toEqual(Uint8Array.of(...bytes, 0));
    expect(bytesToText(Uint8Array.of(...bytes, 0))).toBe(text);
    expect(bytesToText(Uint8Array.of(...bytes, 1))).not.toBe(text);
    // A character outside the 32,768, anywhere: just below and just above them, a letter, a control character, half a pair.
    for (const code of [0x4dff, 0xce00, 0x41, 0x00, 0x0a, 0xd800, 0xdfff, 0xffff]) {
      for (const index of [0, 10, text.length - 1]) expect(textToBytes(`${text.slice(0, index)}${char(code)}${text.slice(index + 1)}`, 40), code.toString(16)).toBeUndefined();
    }
    // Bits left over that are not zero: 40 bytes are 320 bits, and 22 characters hold 330.
    const last = text.charCodeAt(text.length - 1) - 0x4e00;
    expect(last & 0x3ff).toBe(0);
    for (const bit of [1, 2, 0x200]) expect(textToBytes(`${text.slice(0, -1)}${char(0x4e00 + (last | bit))}`, 40), String(bit)).toBeUndefined();
    expect(textToBytes(`${text.slice(0, -1)}${char(0x4e00 + last)}`, 40)).toEqual(bytes);
    expect(textToBytes(char(0x4e00 + 1), 1)).toBeUndefined();
    expect(textToBytes(char(0x4e00 + 0x80), 1)).toEqual(Uint8Array.of(0x01));
  });
});

describe("A result kept across a refresh of the results tab", () => {
  it("gives an app's result back as it was, to the last cell, with the time it was complete", async () => {
    const storage = new FakeStorage();
    const outcome = await page(storage).keep(APP, AT);
    expect(outcome).toMatchObject({ kept: true, keys: 2 });
    const back = await page(storage).takeBack();
    if (!back.found) throw new Error(back.message);
    expect(back.result).toStrictEqual(APP);
    expect(back.result).not.toBe(APP);
    expect(lastCell(back.result)).toBe(0.125);
    expect(back.received).toBeInstanceOf(Date);
    expect(back.received.getTime()).toBe(AT.getTime());
    // The zip is stamped with that time: after the refresh a download has the bytes it had before.
    expect(sameBytes(resultZip(back.result, back.received), resultZip(APP, AT))).toBe(true);
    expect(sameBytes(resultZip(back.result, back.received), resultZip(APP, new Date(AT.getTime() + 2000)))).toBe(false);
  });

  it("gives a model's result back as it was, to the last cell, with the time it was complete", async () => {
    const storage = new FakeStorage();
    const result = madeUpModel(300);
    const wanted = copy(result);
    expect(await page(storage).keep(result, AT)).toMatchObject({ kept: true });
    const back = await page(storage).takeBack();
    if (!back.found) throw new Error(back.message);
    expect(back.result).toStrictEqual(wanted);
    expect(back.result.tables.map(table => table.rows.length)).toEqual([11, 312, 12, 18, 12, 40, 3]);
    expect(lastCell(back.result)).toBe("Jan 27");
    expect(back.result.tables[1].rows.at(-1)).toEqual(wanted.tables[1].rows.at(-1));
    expect(back.result.tables[1].rows.at(-1)?.length).toBe(27);
    expect(back.received.getTime()).toBe(AT.getTime());
    expect(sameBytes(resultZip(back.result, back.received), resultZip(wanted, AT))).toBe(true);
  });

  it("keeps every text as it is: characters of any script, the invisible ones, and halves of a pair", async () => {
    const storage = new FakeStorage();
    const texts = ["", " ", "—", "…", "naïve café", "販売計画", "تخطيط", String.fromCodePoint(0x1f600), char(0xd83d), char(0xde00), `a${char(0)}b`, `line${char(0x2028)}break${char(0x2029)}`,
      `${char(0x202e)}reversed`, 'say "hi"', "back\\slash", "tab\tand\r\nbreak", "</script>", char(0x4e00), char(0xcdff), char(0xfeff), char(0xffff), "x".repeat(250_000)];
    const numbers = [0, 1, -1, 0.1, -2.5e-7, 1.476e12, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, 1e21, 5e-324];
    const result: AnalysisResult = { ...APP, name: texts.join("|"), summary: texts, tables: [{ file: "Texts.csv", label: texts[11], headers: texts, rows: [texts, numbers, []], guard: false }] };
    expect(await page(storage).keep(result, AT)).toMatchObject({ kept: true });
    const back = await page(storage).takeBack();
    if (!back.found) throw new Error(back.message);
    expect(back.result).toStrictEqual(result);
    expect(back.result.tables[0].rows[0].map(cell => String(cell).length)).toEqual(texts.map(text => text.length));
  });

  it("keeps the time to the millisecond, whenever it was", async () => {
    for (const at of [new Date(0), new Date(-1), new Date(Date.UTC(1999, 11, 31, 23, 59, 59, 999)), new Date(8.64e15), AT]) {
      const storage = new FakeStorage();
      expect(await page(storage).keep(APP, at)).toMatchObject({ kept: true });
      const back = await page(storage).takeBack();
      expect(back.found && back.received.getTime(), at.toISOString()).toBe(at.getTime());
    }
  });

  it("gives the result back at every refresh, not only the first", async () => {
    const storage = new FakeStorage();
    await page(storage).keep(APP, AT);
    const held = storage.entries();
    for (let refresh = 0; refresh < 3; refresh++) {
      const back = await page(storage).takeBack();
      expect(back.found && back.result).toStrictEqual(APP);
      expect(storage.entries()).toEqual(held);
    }
    // Taking it back writes nothing and removes nothing.
    expect(storage.touched).toEqual([HEAD, part(0), HEAD]);
  });

  it("keeps a model of 5,000 line items in several keys, in a small part of the room its JSON would take", async () => {
    const storage = new FakeStorage();
    const result = largeModel();
    expect(result.tables[1].rows.length).toBe(5200);
    expect(result.tables[1].rows.every(row => row.length === 27)).toBe(true);
    const outcome = await page(storage).keep(result, AT);
    if (!outcome.kept) throw new Error(outcome.message);
    // What node 24 gave for this model: 5,221,759 bytes of JSON; 665,663 bytes compressed, 7.8 times fewer; 355,171 characters
    // in 5 keys, which is 710,342 bytes at two bytes each. The compressed size is the compressor's, so it is held to a range.
    expect(outcome.jsonBytes).toBe(utf8(JSON.stringify(result)).length);
    expect(outcome.jsonBytes).toBe(5_221_759);
    expect(outcome.packedBytes).toBeGreaterThan(600_000);
    expect(outcome.packedBytes).toBeLessThan(730_000);
    // The parts hold 15 bits to a character, each part but the last is full, and the head is one key more.
    const characters = Math.ceil((outcome.packedBytes * 8) / 15);
    expect(outcome.keys).toBe(Math.ceil(characters / PART_CHARS) + 1);
    expect(outcome.keys).toBe(5);
    const parts = Array.from({ length: outcome.keys - 1 }, (_, index) => part(index));
    expect(kept(storage).sort()).toEqual([...parts, HEAD].sort());
    // The head is removed before anything is written, and written after every part.
    expect(storage.touched).toEqual([HEAD, ...parts, HEAD]);
    expect(parts.map(key => storage.getItem(key)?.length)).toEqual(parts.map((_, index) => (index < parts.length - 1 ? PART_CHARS : characters - PART_CHARS * (parts.length - 1))));
    // The count it reports is what the storage holds, keys included.
    expect(outcome.storedChars).toBe(storage.chars());
    expect(outcome.storedChars * 2).toBeLessThan(outcome.jsonBytes * 0.15);
    // Base64 would take two and a half times the characters for the same bytes.
    expect(Math.ceil(outcome.packedBytes / 3) * 4).toBeGreaterThan(characters * 2.4);
    const back = await page(storage).takeBack();
    if (!back.found) throw new Error(back.message);
    expect(back.result).toStrictEqual(result);
    expect(lastCell(back.result)).toBe("Jan 27");
    expect(back.received.getTime()).toBe(AT.getTime());
  });

  it("keeps the result as it was handed over, whatever happens to it while it is compressed", async () => {
    const storage = new FakeStorage();
    const result = copy(APP);
    const pending = page(storage).keep(result, AT);
    result.name = "Changed after it was handed over";
    result.tables[2].rows.push(["Late", 9, "added", "Grid", "card-z"]);
    result.tables.pop();
    expect(await pending).toMatchObject({ kept: true });
    const back = await page(storage).takeBack();
    expect(back.found && back.result).toStrictEqual(APP);
  });

  it("puts a second result in the place of the first and leaves no key of the first", async () => {
    const storage = new FakeStorage({ "cardigan-theme": "dark" });
    const keeper = page(storage);
    const first = await keeper.keep(NOISE, AT);
    expect(first).toMatchObject({ kept: true });
    expect(kept(storage).length).toBeGreaterThan(3);
    const later = new Date(AT.getTime() + 90_000);
    const pending = keeper.keep(APP, later);
    // The first result goes at once, before the second is compressed: a refresh now finds nothing, not the result before the last.
    expect(kept(storage)).toEqual([]);
    expect(await pending).toMatchObject({ kept: true, keys: 2 });
    expect(kept(storage).sort()).toEqual([part(0), HEAD].sort());
    const back = await page(storage).takeBack();
    if (!back.found) throw new Error(back.message);
    expect(back.result).toStrictEqual(APP);
    expect(back.received.getTime()).toBe(later.getTime());
    // And a larger one after a smaller one.
    const large = NOISE;
    expect(await keeper.keep(large, AT)).toEqual(first);
    const again = await page(storage).takeBack();
    expect(again.found && again.result).toStrictEqual(large);
    expect(storage.getItem("cardigan-theme")).toBe("dark");
  });

  it("forgets the kept result", async () => {
    const storage = new FakeStorage({ "cardigan-theme": "dark" });
    const keeper = page(storage);
    await keeper.keep(NOISE, AT);
    expect(kept(storage).length).toBeGreaterThan(3);
    expect(keeper.forget()).toBeUndefined();
    expect(storage.keys()).toEqual(["cardigan-theme"]);
    expect(await page(storage).takeBack()).toMatchObject({ found: false, reason: "nothing-kept" });
    // Forgetting when nothing is kept is nothing.
    keeper.forget();
    page(new FakeStorage()).forget();
    expect(storage.keys()).toEqual(["cardigan-theme"]);
  });

  it("has nothing to give back on a page where nothing was kept, and removes parts that have no head", async () => {
    expect(await page(new FakeStorage()).takeBack()).toEqual({ found: false, reason: "nothing-kept", message: "No result is kept for this page." });
    // A write that did not finish leaves parts and no head: that is nothing kept, and the parts go.
    const storage = new FakeStorage({ "cardigan-theme": "dark" });
    await page(storage).keep(NOISE, AT);
    storage.put(HEAD, undefined);
    expect(kept(storage).length).toBeGreaterThan(2);
    expect(await page(storage).takeBack()).toMatchObject({ found: false, reason: "nothing-kept" });
    expect(storage.keys()).toEqual(["cardigan-theme"]);
  });
});

describe("A result that cannot be kept", () => {
  /** A storage that holds an earlier result and a key of another part of the page. */
  async function withEarlier(): Promise<FakeStorage> {
    const storage = new FakeStorage({ "cardigan-theme": "dark" });
    expect(await page(storage).keep(APP, AT)).toMatchObject({ kept: true });
    storage.writes = 0;
    return storage;
  }
  /** Nothing of any result is left, the earlier one included, and the page has nothing to take back. */
  async function nothingLeft(storage: FakeStorage): Promise<void> {
    expect(storage.entries()).toEqual({ "cardigan-theme": "dark" });
    expect(await page(storage).takeBack()).toMatchObject({ found: false, reason: "nothing-kept" });
  }

  it("keeps nothing when the storage refuses the first write", async () => {
    const storage = await withEarlier();
    storage.failing = { write: 1, error: full(part(0)) };
    const outcome = await page(storage).keep(NOISE, AT);
    expect(outcome).toMatchObject({ kept: false, reason: "too-large" });
    expect(outcome.kept ? "" : outcome.message).toMatch(/^This result is too large to keep across a refresh: the tab's session storage is full \(.*exceeded the quota\.\)\.$/);
    await nothingLeft(storage);
  });

  it("keeps nothing when the storage refuses a later write: no part of the result stays", async () => {
    const whole = new FakeStorage();
    const fits = await page(whole).keep(NOISE, AT);
    if (!fits.kept) throw new Error(fits.message);
    expect(fits.keys).toBeGreaterThan(3);
    // Each write in turn is the one refused: every part, and the head that goes last.
    for (let write = 1; write <= fits.keys; write++) {
      const storage = await withEarlier();
      storage.failing = { write, error: full("a key") };
      expect(await page(storage).keep(NOISE, AT), String(write)).toMatchObject({ kept: false, reason: "too-large" });
      expect(storage.writes, String(write)).toBe(write);
      await nothingLeft(storage);
    }
    // One write more than it makes: nothing is refused.
    const storage = await withEarlier();
    storage.failing = { write: fits.keys + 1, error: full("a key") };
    expect(await page(storage).keep(NOISE, AT)).toEqual(fits);
  });

  it("keeps nothing when the result does not fit the room the browser gives, and all of it when it just does", async () => {
    const whole = new FakeStorage();
    const fits = await page(whole).keep(NOISE, AT);
    if (!fits.kept) throw new Error(fits.message);
    const theme = "cardigan-theme".length + "dark".length;
    for (const short of [1, PART_CHARS, fits.storedChars - 1, fits.storedChars]) {
      const storage = await withEarlier();
      storage.room = theme + fits.storedChars - short;
      expect(await page(storage).keep(NOISE, AT), String(short)).toMatchObject({ kept: false, reason: "too-large" });
      await nothingLeft(storage);
    }
    const storage = await withEarlier();
    storage.room = theme + fits.storedChars;
    expect(await page(storage).keep(NOISE, AT)).toEqual(fits);
    expect(storage.chars()).toBe(storage.room);
  });

  it("says that it failed, not that the result is too large, when the storage refuses for another reason", async () => {
    const storage = await withEarlier();
    storage.failing = { write: 2, error: new Error("The storage is gone.") };
    expect(await page(storage).keep(NOISE, AT)).toEqual({ kept: false, reason: "failed",
      message: "This result is not kept across a refresh: the tab's session storage refused it (The storage is gone.)." });
    await nothingLeft(storage);
  });

  it("does not compress a result whose JSON is over the limit, and compresses one that is just at it", async () => {
    const compressed: number[] = [];
    const compress = async (bytes: Uint8Array) => { compressed.push(bytes.length); return gzipped("{}"); };
    const sized = (length: number): AnalysisResult => ({ kind: "model", name: "x".repeat(length), id: "", zipName: "", tables: [], summary: [] });
    const around = JSON.stringify(sized(0)).length;
    const storage = await withEarlier();
    expect(await page(storage, { compress }).keep(sized(MAX_JSON_BYTES - around + 1), AT)).toEqual({ kept: false, reason: "too-large",
      message: "This result is too large to keep across a refresh: as JSON it is over 64.0 MB." });
    expect(compressed).toEqual([]);
    await nothingLeft(storage);
    // A character of two bytes: the JSON has fewer characters than the limit and more bytes.
    const wide: AnalysisResult = { ...sized(0), name: "é".repeat(Math.floor((MAX_JSON_BYTES - around) / 2) + 1) };
    expect(JSON.stringify(wide).length).toBeLessThan(MAX_JSON_BYTES);
    expect(await page(storage, { compress }).keep(wide, AT)).toMatchObject({ kept: false, reason: "too-large" });
    expect(compressed).toEqual([]);
    expect(kept(storage)).toEqual([]);
    expect(await page(storage, { compress }).keep(sized(MAX_JSON_BYTES - around), AT)).toMatchObject({ kept: true, jsonBytes: MAX_JSON_BYTES });
    expect(compressed).toEqual([MAX_JSON_BYTES]);
  });

  it("keeps nothing when the compressed result is over the limit, and all of it when it is just at it", async () => {
    const json = utf8(JSON.stringify(APP));
    const storage = await withEarlier();
    expect(await page(storage, { compress: async () => new Uint8Array(MAX_PACKED_BYTES + 1) }).keep(APP, AT)).toEqual({ kept: false, reason: "too-large",
      message: "This result is too large to keep across a refresh: compressed it is 9.0 MB, and at most 9.0 MB is kept." });
    expect(storage.writes).toBe(0);
    await nothingLeft(storage);
    // At the limit: 4,800,000 characters in 48 parts. With their keys and the head they take less than 10 MiB at two bytes
    // each, the room Chrome is understood to give, and leave a twelfth of it free.
    const largest = new Uint8Array(MAX_PACKED_BYTES);
    for (let index = 0; index < largest.length; index++) largest[index] = (index * 151) & 0xff;
    const outcome = await page(storage, { compress: async () => largest }).keep(APP, AT);
    if (!outcome.kept) throw new Error(outcome.message);
    expect(outcome).toMatchObject({ packedBytes: 9_000_000, keys: 49 });
    expect(outcome.storedChars).toBe(storage.chars() - "cardigan-theme".length - "dark".length);
    expect(outcome.storedChars - 4_800_000).toBeLessThan(1000);
    expect(outcome.storedChars * 2).toBeLessThan(10 * 1024 * 1024 * 0.92);
    let expanded: Uint8Array | undefined;
    const back = await page(storage, { expand: async bytes => { expanded = bytes; return json; } }).takeBack();
    expect(back.found && back.result).toStrictEqual(APP);
    expect(sameBytes(expanded, largest)).toBe(true);
  });

  it("says why, and keeps nothing, when the result cannot be written or compressed", async () => {
    const circular: Record<string, unknown> = { summary: [], tables: [] };
    circular.self = circular;
    const cases: [what: string, keep: (storage: FakeStorage) => Promise<unknown>, message: RegExp][] = [
      ["a page without an Anaplan tab", storage => page(storage, { tabId: undefined }).keep(APP, AT), /^This result is not kept across a refresh: the page's address names no Anaplan tab\.$/],
      ["a tab ID below zero", storage => page(storage, { tabId: -1 }).keep(APP, AT), /^This result is not kept across a refresh: the page's address names no Anaplan tab\.$/],
      ["a tab ID that is no whole number", storage => page(storage, { tabId: 4521.5 }).keep(APP, AT), /^This result is not kept across a refresh: the page's address names no Anaplan tab\.$/],
      ["a tab ID that is no number", storage => page(storage, { tabId: Number.NaN }).keep(APP, AT), /^This result is not kept across a refresh: the page's address names no Anaplan tab\.$/],
      ["a time that is none", storage => page(storage).keep(APP, new Date(Number.NaN)), /^This result is not kept across a refresh: the time it was complete at is not a time\.$/],
      ["no time at all", storage => page(storage).keep(APP, undefined as unknown as Date), /^This result is not kept across a refresh: keeping it failed \(.+\)\.$/],
      ["nothing", storage => page(storage).keep(undefined as unknown as AnalysisResult, AT), /^This result is not kept across a refresh: it cannot be written as JSON\.$/],
      ["a result that holds itself", storage => page(storage).keep(circular as unknown as AnalysisResult, AT), /^This result is not kept across a refresh: keeping it failed \(Converting circular structure to JSON.*\)\.$/s],
      ["a number JSON has no way to write", storage => page(storage).keep({ ...APP, id: 10n } as unknown as AnalysisResult, AT), /^This result is not kept across a refresh: keeping it failed \(.*BigInt.*\)\.$/],
      ["compression that fails", storage => page(storage, { compress: async () => { throw new Error("No compression here"); } }).keep(APP, AT), /^This result is not kept across a refresh: keeping it failed \(No compression here\)\.$/],
      ["compression that gives no bytes", storage => page(storage, { compress: async () => undefined as unknown as Uint8Array }).keep(APP, AT), /^This result is not kept across a refresh: keeping it failed \(.+\)\.$/],
    ];
    for (const [what, keep, message] of cases) {
      const storage = await withEarlier();
      const outcome = await keep(storage) as { kept: boolean; reason?: string; message?: string };
      expect(outcome, what).toMatchObject({ kept: false, reason: "failed" });
      expect(outcome.message, what).toMatch(message);
      expect(storage.writes, what).toBe(0);
      await nothingLeft(storage);
    }
  });
});

describe("A kept result that is not given back", () => {
  /** A storage with a result kept in several parts, and a key of another part of the page. The result is kept once, and
   * each storage holds what that one held. */
  let held: Record<string, string> | undefined;
  async function keptNoise(): Promise<FakeStorage> {
    if (!held) {
      const storage = new FakeStorage();
      expect(await page(storage).keep(NOISE, AT)).toMatchObject({ kept: true });
      expect(kept(storage).length).toBeGreaterThan(3);
      held = storage.entries();
    }
    return new FakeStorage({ "cardigan-theme": "dark", ...held });
  }
  /** The kept result was removed, whole, and nothing else was. A page loaded after that finds nothing kept. */
  async function removed(storage: FakeStorage): Promise<void> {
    expect(storage.entries()).toEqual({ "cardigan-theme": "dark" });
    expect(await page(storage).takeBack()).toMatchObject({ found: false, reason: "nothing-kept" });
  }
  const headOf = (storage: FakeStorage): Record<string, unknown> => JSON.parse(storage.getItem(HEAD) ?? "");

  it("is one that another version of the extension kept", async () => {
    for (const version of ["0.7.1", "0.6.1", "0.7.0 ", "0.7", "", "dev"]) {
      const storage = await keptNoise();
      const back = await page(storage, { version }).takeBack();
      expect(back, version).toEqual({ found: false, reason: "other-version", message: `The kept result is Cardigan 0.7.0's, and this is Cardigan ${version}. It was removed.` });
      await removed(storage);
    }
    // The same version takes it back.
    const storage = await keptNoise();
    expect(await page(storage, { version: RELEASE }).takeBack()).toMatchObject({ found: true });
  });

  it("is one that was kept for another Anaplan tab than the one the page's address names", async () => {
    for (const tabId of [TAB + 1, 0, 45210, undefined]) {
      const storage = await keptNoise();
      const back = await page(storage, { tabId }).takeBack();
      expect(back, String(tabId)).toMatchObject({ found: false, reason: "other-tab" });
      await removed(storage);
    }
    const storage = await keptNoise();
    expect(await page(storage, { tabId: undefined }).takeBack()).toMatchObject({ message: "The kept result came from Anaplan tab 4521, and this page is for none. It was removed." });
    // Tab 0 is a tab like any other.
    const zero = new FakeStorage();
    await page(zero, { tabId: 0 }).keep(APP, AT);
    expect(await page(zero, { tabId: 0 }).takeBack()).toMatchObject({ found: true });
    expect(await page(zero, { tabId: undefined }).takeBack()).toMatchObject({ found: false, reason: "other-tab" });
  });

  it("is one with a part missing, whichever part", async () => {
    const parts = kept(await keptNoise()).length - 1;
    for (let missing = 0; missing < parts; missing++) {
      const storage = await keptNoise();
      storage.put(part(missing), undefined);
      expect(await page(storage).takeBack(), String(missing)).toEqual({ found: false, reason: "incomplete", message: `The kept result lacks part ${missing + 1} of ${parts}. It was removed.` });
      await removed(storage);
    }
  });

  it("is one with a part that was changed, by one character anywhere", async () => {
    const original = new FakeStorage();
    await page(original).keep(APP, AT);
    const text = original.getItem(part(0)) ?? "";
    expect(text.length).toBeGreaterThan(200);
    // Each character in turn becomes another of the 32,768, with one bit changed: no expanding is tried on any of them.
    const expand = vi.fn(async () => utf8("{}"));
    for (let index = 0; index < text.length; index++) {
      const storage = new FakeStorage({ ...original.entries(), "cardigan-theme": "dark" });
      storage.put(part(0), `${text.slice(0, index)}${char(0x4e00 + ((text.charCodeAt(index) - 0x4e00) ^ (1 << (index % 15))))}${text.slice(index + 1)}`);
      expect(await page(storage, { expand }).takeBack(), String(index)).toEqual({ found: false, reason: "damaged", message: "The kept result's parts do not hold what its head says. It was removed." });
      expect(storage.entries(), String(index)).toEqual({ "cardigan-theme": "dark" });
    }
    expect(expand).not.toHaveBeenCalled();
  });

  it("is one with a part that is shorter, longer, not of the 32,768 characters, or in another part's place", async () => {
    const changes: [what: string, change: (storage: FakeStorage) => void][] = [
      ["a part cut short", storage => storage.put(part(1), storage.getItem(part(1))?.slice(0, -1))],
      ["a part made longer", storage => storage.put(part(1), `${storage.getItem(part(1))}${char(0x4e00)}`)],
      ["a part that is empty", storage => storage.put(part(0), "")],
      ["a letter in a part", storage => storage.put(part(1), `A${storage.getItem(part(1))?.slice(1)}`)],
      ["half a pair in a part", storage => storage.put(part(1), `${storage.getItem(part(1))?.slice(0, -1)}${char(0xd800)}`)],
      ["two parts in each other's place", storage => {
        const first = storage.getItem(part(0));
        storage.put(part(0), storage.getItem(part(1)) ?? "");
        storage.put(part(1), first ?? "");
      }],
    ];
    for (const [what, change] of changes) {
      const storage = await keptNoise();
      change(storage);
      expect(await page(storage).takeBack(), what).toMatchObject({ found: false, reason: "damaged" });
      await removed(storage);
    }
  });

  it("is one whose head says something else than the parts hold", async () => {
    const heads: [what: string, head: (head: Record<string, unknown>) => unknown][] = [
      ["one byte fewer", head => ({ ...head, bytes: Number(head.bytes) - 1 })],
      ["one byte more", head => ({ ...head, bytes: Number(head.bytes) + 1 })],
      ["fewer bytes than the first part holds", head => ({ ...head, bytes: 1000 })],
      ["no bytes", head => ({ ...head, bytes: 0 })],
      ["another checksum", head => ({ ...head, crc: (Number(head.crc) ^ 1) >>> 0 })],
      ["no checksum to speak of", head => ({ ...head, crc: 0 })],
    ];
    for (const [what, change] of heads) {
      const storage = await keptNoise();
      storage.put(HEAD, JSON.stringify(change(headOf(storage))));
      expect(await page(storage).takeBack(), what).toEqual({ found: false, reason: "damaged", message: "The kept result's parts do not hold what its head says. It was removed." });
      await removed(storage);
    }
    // More bytes than the parts there are could hold: a part is missing.
    const storage = await keptNoise();
    const parts = kept(storage).length - 1;
    storage.put(HEAD, JSON.stringify({ ...headOf(storage), bytes: (PART_CHARS * parts * 15) / 8 + 1 }));
    expect(await page(storage).takeBack()).toEqual({ found: false, reason: "incomplete", message: `The kept result lacks part ${parts + 1} of ${parts + 1}. It was removed.` });
    await removed(storage);
  });

  it("is one whose head is not a head", async () => {
    const heads: [what: string, head: (head: Record<string, unknown>) => unknown][] = [
      ["a version that is no text", head => ({ ...head, version: 7 })],
      ["no version", head => ({ ...head, version: undefined })],
      ["a tab that is a text", head => ({ ...head, tab: String(TAB) })],
      ["a tab below zero", head => ({ ...head, tab: -1 })],
      ["a tab that is no whole number", head => ({ ...head, tab: TAB + 0.5 })],
      ["no tab", head => ({ ...head, tab: undefined })],
      ["a time that is a text", head => ({ ...head, received: AT.toISOString() })],
      ["a time that is no whole number", head => ({ ...head, received: AT.getTime() + 0.5 })],
      ["a time beyond the last one", head => ({ ...head, received: 8.64e15 + 1 })],
      ["a time before the first one", head => ({ ...head, received: -8.64e15 - 1 })],
      ["no time", head => ({ ...head, received: null })],
      ["bytes that are a text", head => ({ ...head, bytes: String(head.bytes) })],
      ["bytes below zero", head => ({ ...head, bytes: -1 })],
      ["bytes that are no whole number", head => ({ ...head, bytes: Number(head.bytes) + 0.5 })],
      ["no bytes said", head => ({ ...head, bytes: undefined })],
      ["a checksum that is a text", head => ({ ...head, crc: String(head.crc) })],
      ["a checksum below zero", head => ({ ...head, crc: -1 })],
      ["no checksum", head => ({ ...head, crc: undefined })],
      ["nothing", () => null],
      ["a list", () => []],
      ["a text", () => "head"],
      ["a number", () => 7],
      ["an empty object", () => ({})],
    ];
    const unreadable = { found: false, reason: "damaged", message: "The kept result's head cannot be read. It was removed." };
    for (const [what, change] of heads) {
      const storage = await keptNoise();
      storage.put(HEAD, JSON.stringify(change(headOf(storage))));
      expect(await page(storage).takeBack(), what).toEqual(unreadable);
      await removed(storage);
    }
    for (const written of ["", "{", "head", '{"version":"0.7.0"']) {
      const storage = await keptNoise();
      storage.put(HEAD, written);
      expect(await page(storage).takeBack(), written).toEqual(unreadable);
      await removed(storage);
    }
    // The head as it was written is one: the same storage gives the result back. So does a head with a field more.
    for (const more of [{}, { later: "field" }]) {
      const storage = await keptNoise();
      storage.put(HEAD, JSON.stringify({ ...headOf(storage), ...more }));
      const back = await page(storage).takeBack();
      expect(back.found && back.result).toStrictEqual(NOISE);
    }
  });

  it("is one whose bytes do not expand, or expand to something that is not JSON", async () => {
    const invalid = new Uint8Array([...utf8('{"summary":[],"tables":[],"name":"'), 0xff, ...utf8('"}')]);
    const cases: [what: string, packed: Uint8Array, message: RegExp][] = [
      ["bytes that are not gzip", utf8("These bytes were never compressed."), /^The kept result could not be expanded \(.*\)\. It was removed\.$/],
      ["gzip that stops early", gzipped(JSON.stringify(APP)).slice(0, -9), /^The kept result could not be expanded \(.*\)\. It was removed\.$/],
      ["gzip with bytes after its end", new Uint8Array([...gzipped(JSON.stringify(APP)), 1, 2, 3]), /^The kept result could not be expanded \(.*\)\. It was removed\.$/],
      ["no bytes at all", new Uint8Array(0), /^The kept result could not be expanded \(.*\)\. It was removed\.$/],
      ["text that is not JSON", gzipped("Not JSON."), /^The kept result is not JSON \(.+\)\. It was removed\.$/],
      ["JSON that is cut off", gzipped(JSON.stringify(APP).slice(0, -1)), /^The kept result is not JSON \(.+\)\. It was removed\.$/],
      ["nothing where the JSON should be", gzipped(""), /^The kept result is not JSON \(.+\)\. It was removed\.$/],
      // Read leniently, these bytes are a result with a name that is not the one that was written.
      ["bytes that are not UTF-8", gzipped(invalid), /^The kept result could not be expanded \(.*\)\. It was removed\.$/],
    ];
    for (const [what, packed, message] of cases) {
      const storage = new FakeStorage({ "cardigan-theme": "dark" });
      expect(await page(storage, { compress: async () => packed }).keep(APP, AT), what).toMatchObject({ kept: true });
      const back = await page(storage).takeBack();
      expect(back, what).toMatchObject({ found: false, reason: "damaged" });
      expect(back.found ? "" : back.message, what).toMatch(message);
      await removed(storage);
    }
    // Expanding that fails for a reason of its own counts the same.
    const storage = await keptNoise();
    expect(await page(storage, { expand: async () => { throw new Error("No expanding here"); } }).takeBack()).toEqual({ found: false, reason: "damaged",
      message: "The kept result could not be expanded (No expanding here). It was removed." });
    await removed(storage);
  });

  it("is something that is not a result: the shape the page itself asks of one the tab sends", async () => {
    const table = { file: "Cards.csv", label: "Cards", headers: ["Page"], rows: [["Overview"]], guard: true };
    const shapes: [what: string, value: unknown][] = [
      ["nothing", null], ["a text", "result"], ["a number", 7], ["a list", []], ["a list of results", [APP]], ["an empty object", {}],
      ["no summary", { ...APP, summary: undefined }], ["a summary that is a text", { ...APP, summary: "2 pages" }], ["a summary that is an object", { ...APP, summary: { 0: "2 pages" } }],
      ["no tables", { ...APP, tables: undefined }], ["tables that are a number", { ...APP, tables: 5 }], ["tables that are an object", { ...APP, tables: { 0: table } }],
      ["a table that is nothing", { ...APP, tables: [table, null] }], ["a table that is a text", { ...APP, tables: ["Cards", table] }],
      ["a table without headers", { ...APP, tables: [{ ...table, headers: undefined }] }], ["headers that are a text", { ...APP, tables: [{ ...table, headers: "Page" }] }],
      ["a table without rows", { ...APP, tables: [{ ...table, rows: undefined }] }], ["rows that are a number", { ...APP, tables: [{ ...table, rows: 3 }] }],
      ["a row that is a text", { ...APP, tables: [table, { ...table, rows: [["Overview"], "Detail"] }] }], ["a row that is nothing", { ...APP, tables: [{ ...table, rows: [null] }] }],
      ["a row that is an object", { ...APP, tables: [{ ...table, rows: [{ 0: "Overview" }] }] }],
    ];
    for (const [what, value] of shapes) {
      const storage = new FakeStorage({ "cardigan-theme": "dark" });
      expect(await page(storage).keep(value as AnalysisResult, AT), what).toMatchObject({ kept: true });
      expect(await page(storage).takeBack(), what).toEqual({ found: false, reason: "not-a-result", message: "What was kept is not a result. It was removed." });
      await removed(storage);
    }
    // What the page asks no question about comes back as it was kept: a result with nothing in it, and fields of a later version.
    for (const value of [{ summary: [], tables: [] }, { ...APP, tables: [{ headers: [], rows: [] }] }, { ...APP, later: { field: [1, 2] }, tables: [{ ...table, shown: "wide" }] }]) {
      const storage = new FakeStorage();
      await page(storage).keep(value as unknown as AnalysisResult, AT);
      const back = await page(storage).takeBack();
      expect(back.found && back.result).toStrictEqual(value);
    }
  });
});

describe("Calls on the keeper that overlap", () => {
  /** Compression that ends when the test says: each call waits to be let go, by its place among the calls. */
  function waitingCompression() {
    const waiting: (() => void)[] = [];
    const compress = (bytes: Uint8Array): Promise<Uint8Array> => new Promise(resolve => { waiting.push(() => resolve(gzipped(bytes))); });
    return { compress, release: (call: number) => waiting[call]() };
  }

  it("keeps the result handed over last, however long each takes to compress", async () => {
    for (const order of [[0, 1], [1, 0]]) {
      const storage = new FakeStorage();
      const { compress, release } = waitingCompression();
      const keeper = page(storage, { compress });
      const later = new Date(AT.getTime() + 60_000);
      const first = keeper.keep(APP, AT);
      const second = keeper.keep(NOISE, later);
      for (const call of order) release(call);
      expect(await first, String(order)).toEqual({ kept: false, reason: "superseded", message: "A later result, or forgetting, took this result's place before it was kept." });
      expect(await second, String(order)).toMatchObject({ kept: true });
      const back = await page(storage).takeBack();
      if (!back.found) throw new Error(back.message);
      expect(back.result).toStrictEqual(NOISE);
      expect(back.received.getTime()).toBe(later.getTime());
      // The first result wrote nothing: each key was written once, by the second.
      expect(storage.writes).toBe(kept(storage).length);
    }
  });

  it("keeps nothing of a result that is forgotten while it is compressed", async () => {
    const storage = new FakeStorage();
    const { compress, release } = waitingCompression();
    const keeper = page(storage, { compress });
    const pending = keeper.keep(APP, AT);
    keeper.forget();
    release(0);
    expect(await pending).toMatchObject({ kept: false, reason: "superseded" });
    expect(storage.writes).toBe(0);
    expect(storage.keys()).toEqual([]);
    // A result handed over after the forgetting is kept as any other.
    keeper.forget();
    const next = keeper.keep(APP, AT);
    release(1);
    expect(await next).toMatchObject({ kept: true });
  });

  it("gives nothing back, and removes nothing, when a result is kept or forgotten while the kept one is read", async () => {
    for (const fails of [false, true]) {
      for (const change of ["keep", "forget"] as const) {
        const storage = new FakeStorage();
        await page(storage).keep(APP, AT);
        let finish: () => void = () => undefined;
        const expand = (): Promise<Uint8Array> => new Promise((resolve, reject) => {
          finish = () => (fails ? reject(new Error("No expanding here")) : resolve(utf8(JSON.stringify(APP))));
        });
        const keeper = page(storage, { expand });
        const reading = keeper.takeBack();
        const model = madeUpModel(50);
        if (change === "keep") expect(await keeper.keep(model, AT)).toMatchObject({ kept: true });
        else keeper.forget();
        const holds = storage.entries();
        finish();
        expect(await reading, `${change} ${fails}`).toEqual({ found: false, reason: "superseded", message: "A later result, or forgetting, took the kept result's place while it was read." });
        // The storage is the later call's: the result it kept is still there, whole.
        expect(storage.entries()).toEqual(holds);
        const back = await page(storage).takeBack();
        if (change === "keep") expect(back.found && back.result).toStrictEqual(model);
        else expect(back).toMatchObject({ found: false, reason: "nothing-kept" });
      }
    }
  });

  it("reads the kept result when nothing else is asked of the keeper meanwhile, also twice at once", async () => {
    const storage = new FakeStorage();
    const keeper = page(storage);
    await keeper.keep(APP, AT);
    const [one, two] = await Promise.all([keeper.takeBack(), keeper.takeBack()]);
    expect(one.found && one.result).toStrictEqual(APP);
    expect(two.found && two.result).toStrictEqual(APP);
  });
});

describe("The storage a keeper uses", () => {
  /** Keys other parts of the page, or anything else, might hold: none is the module's, though some look like its own. */
  const OTHERS: Record<string, string> = {
    "cardigan-theme": "dark", "cardigan-kept": "not the module's", "cardigan-kept-head": "nor this", "cardigan-kepthead": "x", "head": "x", "0": "x", "kept:0": "x",
    "Cardigan-kept:0": "another case", " cardigan-kept:0": "a space first", "": "no name",
  };

  it("writes and removes only keys that begin with its own prefix, whatever happens", async () => {
    const storage = new FakeStorage(OTHERS);
    const keeper = page(storage);
    expect(KEPT_PREFIX).toBe("cardigan-kept:");
    // Kept, taken back, kept again in fewer keys, forgotten.
    const first = await keeper.keep(NOISE, AT);
    if (!first.kept) throw new Error(first.message);
    await page(storage).takeBack();
    await keeper.keep(APP, AT);
    keeper.forget();
    // Each way a kept result is refused and removed.
    await keeper.keep(NOISE, AT);
    expect(await page(storage, { version: "0.7.1" }).takeBack()).toMatchObject({ reason: "other-version" });
    await keeper.keep(NOISE, AT);
    expect(await page(storage, { tabId: 1 }).takeBack()).toMatchObject({ reason: "other-tab" });
    await keeper.keep(NOISE, AT);
    storage.put(part(1), undefined);
    expect(await page(storage).takeBack()).toMatchObject({ reason: "incomplete" });
    await keeper.keep(NOISE, AT);
    storage.put(part(1), "");
    expect(await page(storage).takeBack()).toMatchObject({ reason: "damaged" });
    await keeper.keep([] as unknown as AnalysisResult, AT);
    expect(await page(storage).takeBack()).toMatchObject({ reason: "not-a-result" });
    // Each way a result is not kept.
    storage.writes = 0;
    storage.failing = { write: 3, error: full("a key") };
    expect(await keeper.keep(NOISE, AT)).toMatchObject({ reason: "too-large" });
    storage.failing = undefined;
    storage.room = storage.chars() + PART_CHARS;
    expect(await keeper.keep(NOISE, AT)).toMatchObject({ reason: "too-large" });
    storage.room = Infinity;
    expect(await page(storage, { compress: async () => new Uint8Array(MAX_PACKED_BYTES + 1) }).keep(APP, AT)).toMatchObject({ reason: "too-large" });
    await keeper.keep(APP, AT);

    expect(storage.touched.length).toBeGreaterThan(60);
    expect(storage.touched.filter(key => !key.startsWith("cardigan-kept:"))).toEqual([]);
    expect([...new Set(storage.touched)].sort()).toEqual([...Array.from({ length: first.keys - 1 }, (_, index) => part(index)), HEAD].sort());
    expect(Object.fromEntries(Object.keys(OTHERS).map(key => [key, storage.getItem(key)]))).toEqual(OTHERS);
    keeper.forget();
    expect(storage.entries()).toEqual(OTHERS);
  });

  it("is the tab's session storage, and never its local storage, when the page hands in none", async () => {
    const session = new FakeStorage();
    const local = new FakeStorage({ "cardigan-theme": "dark" });
    vi.stubGlobal("sessionStorage", session);
    vi.stubGlobal("localStorage", local);
    const keeper = new ResultKeeper({ tabId: TAB });
    expect(await keeper.keep(APP, AT)).toMatchObject({ kept: true, keys: 2 });
    expect(kept(session).sort()).toEqual([part(0), HEAD].sort());
    // The version is the build's own: a page of that version takes the result back, and a page of another does not.
    expect(JSON.parse(session.getItem(HEAD) ?? "")).toMatchObject({ version: VERSION, tab: TAB, received: AT.getTime() });
    const back = await new ResultKeeper({ tabId: TAB }).takeBack();
    expect(back.found && back.result).toStrictEqual(APP);
    expect(await new ResultKeeper({ tabId: TAB, version: `${VERSION}.1` }).takeBack()).toMatchObject({ found: false, reason: "other-version" });
    await keeper.keep(APP, AT);
    new ResultKeeper({ tabId: TAB }).forget();
    expect(session.keys()).toEqual([]);
    expect(local.entries()).toEqual({ "cardigan-theme": "dark" });
    expect(local.touched).toEqual([]);
  });

  it("keeps nothing and gives nothing back, without throwing, on a page that has no session storage or may not read it", async () => {
    const without = async (): Promise<void> => {
      const keeper = new ResultKeeper({ tabId: TAB });
      expect(await keeper.keep(APP, AT)).toEqual({ kept: false, reason: "unavailable", message: "This result is not kept across a refresh: the tab's session storage is not available." });
      expect(await keeper.takeBack()).toEqual({ found: false, reason: "unavailable", message: "Nothing is kept: the tab's session storage is not available." });
      expect(keeper.forget()).toBeUndefined();
    };
    // None; one that is nothing; and one Chrome refuses to hand out, which it does by throwing.
    vi.stubGlobal("sessionStorage", undefined);
    await without();
    vi.stubGlobal("sessionStorage", null);
    await without();
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get() { throw new DOMException("Access is denied for this document.", "SecurityError"); } });
    try {
      expect(() => sessionStorage).toThrow("Access is denied");
      await without();
    } finally {
      delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
    }
  });

  it("ends every call in an outcome when the storage itself throws", async () => {
    const refuse = (): never => { throw new Error("The storage is gone."); };
    const broken: KeptStorage = { get length(): number { return refuse(); }, key: refuse, getItem: refuse, setItem: refuse, removeItem: refuse };
    const keeper = page(broken);
    expect(await keeper.keep(APP, AT)).toEqual({ kept: false, reason: "failed", message: "This result is not kept across a refresh: keeping it failed (The storage is gone.)." });
    expect(await keeper.takeBack()).toEqual({ found: false, reason: "unavailable", message: "Nothing is given back: the tab's session storage failed (The storage is gone.)." });
    expect(keeper.forget()).toBeUndefined();
    // A storage that reads and does not remove: a kept result of another version cannot be removed, and is still not given back.
    const storage = new FakeStorage();
    await page(storage).keep(APP, AT);
    const stuck: KeptStorage = { get length() { return storage.length; }, key: index => storage.key(index), getItem: key => storage.getItem(key), setItem: refuse, removeItem: refuse };
    expect(await page(stuck, { version: "0.7.1" }).takeBack()).toMatchObject({ found: false, reason: "unavailable" });
    expect(await page(stuck).keep(APP, AT)).toMatchObject({ kept: false, reason: "failed" });
    expect(page(stuck).forget()).toBeUndefined();
  });
});
