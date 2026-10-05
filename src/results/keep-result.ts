import type { AnalysisResult } from "../result-types.js";
import { VERSION } from "../version.js";
import { crc32 } from "../zip.js";

/** Keeps the results page's last finished result while its tab is refreshed. A refresh starts the page anew: without this
 * the result is gone, and the analysis has to read Anaplan again.
 *
 * - Where: the tab's own session storage. It takes no permission, a refresh leaves it as it is, and it is the one tab's:
 *   local storage, IndexedDB and chrome.storage keep what they hold for every tab and every later visit. A browser may
 *   give a tab it brings back (a duplicate, a reopened tab, a restored window) the session storage the tab had, which is
 *   one reason the head below is checked.
 * - What: one result per results tab, with the time it was complete (its zip is stamped with that time, so the zip
 *   downloaded after a refresh has the same bytes as the one before it), the ID of the Anaplan tab it came from and the
 *   extension's version. Keeping a result takes the place of the one kept before.
 * - How: session storage holds a few megabytes of text, and a large model's result is larger than that as JSON. So the
 *   JSON is compressed (gzip, by the browser's own CompressionStream) and the bytes are written as text, 15 bits to a
 *   character (`bytesToText`), in parts of PART_CHARS characters under one key each. The head is written after the last
 *   part: it says whose result the parts hold, how many bytes they are and their checksum. Until the head is there
 *   nothing counts as kept, and a write that stops half-way removes what it wrote, so there is never a part of a result.
 * - What comes back: the same result and time, when the head names this version of the extension and the Anaplan tab in
 *   the page's address, every part is there, the bytes have the head's checksum, and they expand and parse to a result.
 *   Anything else is removed, and the page is told that nothing was kept.
 *
 * No call throws and no promise rejects: each ends in an outcome. Keeping and taking back end with a sentence the page can
 * show or log, and forgetting with whether the kept result is gone. */

/** Every key this module writes or removes starts with this. It touches no other key. */
export const KEPT_PREFIX = "cardigan-kept:";
const HEAD_KEY = `${KEPT_PREFIX}head`;
const partKey = (index: number): string => `${KEPT_PREFIX}${index}`;

/** One key holds at most this many characters, so no single value is large whatever the result's size. */
export const PART_CHARS = 100_000;
/** A result whose JSON is more than this many bytes is not kept. Writing the JSON, compressing it and reading it back take
 * a time that grows with it: near this size about 0.7 s to keep and 0.25 s to take back, measured in Node. A made-up
 * model of this size also compressed to the limit below, so a result this large is unlikely to fit the storage anyway. */
export const MAX_JSON_BYTES = 64_000_000;
/** The most compressed bytes that are kept: 4,800,000 characters as text. Chrome is understood to give an origin's
 * session storage 10 MiB in a tab, and to count every character of a key or a value as two bytes: 5,242,880 characters.
 * That has not been measured on an extension page. This limit leaves about a twelfth of it free. A result the browser
 * refuses all the same is not kept either. */
export const MAX_PACKED_BYTES = 9_000_000;

/** The first of the 32,768 characters the bytes are written in: U+4E00 to U+CDFF. None is a control character, a
 * separator of lines or half of a surrogate pair, so the text is well formed and is stored and read back as it is. */
const FIRST_CHAR = 0x4e00;
const CHAR_BITS = 15;
const textLength = (bytes: number): number => Math.ceil((bytes * 8) / CHAR_BITS);
/** How many characters String.fromCharCode is handed at once: a call takes only so many arguments. */
const AT_ONCE = 8192;

/** Bytes as text, 15 bits to a character. Session storage holds text only, and the room it gives is understood to be
 * counted in characters, so a character carries as much as it can: base64 would put 6 bits in each, and take two and a
 * half times the room. The bits are taken in order, high bit first, and the last character's unused low bits are zero. */
export function bytesToText(bytes: Uint8Array): string {
  const codes = new Uint16Array(textLength(bytes.length));
  let held = 0;
  let bits = 0;
  let at = 0;
  for (let index = 0; index < bytes.length; index++) {
    held = (held << 8) | bytes[index];
    bits += 8;
    if (bits >= CHAR_BITS) {
      bits -= CHAR_BITS;
      codes[at++] = FIRST_CHAR + (held >>> bits);
      held &= (1 << bits) - 1;
    }
  }
  if (bits > 0) codes[at] = FIRST_CHAR + (held << (CHAR_BITS - bits));
  let text = "";
  for (let start = 0; start < codes.length; start += AT_ONCE) text += String.fromCharCode(...codes.subarray(start, start + AT_ONCE));
  return text;
}

/** The `length` bytes a text of `bytesToText` holds, or undefined when the text is not one for that many bytes: it has
 * another length, a character outside the 32,768, or unused bits that are not zero. The text alone does not say how many
 * bytes it holds: a run of bytes and the same run with a zero after it can have the same text. So the head records the
 * number of bytes, and their checksum. */
export function textToBytes(text: string, length: number): Uint8Array<ArrayBuffer> | undefined {
  if (!Number.isSafeInteger(length) || length < 0 || text.length !== textLength(length)) return undefined;
  const bytes = new Uint8Array(length);
  let held = 0;
  let bits = 0;
  let at = 0;
  for (let index = 0; index < text.length; index++) {
    const value = text.charCodeAt(index) - FIRST_CHAR;
    if (value < 0 || value >= 1 << CHAR_BITS) return undefined;
    held = (held << CHAR_BITS) | value;
    bits += CHAR_BITS;
    while (bits >= 8 && at < length) {
      bits -= 8;
      bytes[at++] = held >>> bits;
      held &= (1 << bits) - 1;
    }
  }
  return held === 0 ? bytes : undefined;
}

/** The part of the tab's session storage the module uses; a test hands in a stand-in. */
export type KeptStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;
type Bytes = Uint8Array<ArrayBuffer>;

export interface KeeperOptions {
  /** The Anaplan tab's ID from the page's address (connection.ts `tabIdFrom`); undefined when the address names none. */
  tabId: number | undefined;
  /** The extension's version: a result is given back only to the version that kept it. The build's own unless a test says. */
  version?: string;
  /** Where the result is kept: the tab's session storage unless a test hands in a stand-in. */
  storage?: KeptStorage;
  /** Compresses the JSON's bytes, and expands them again: gzip by the browser's own streams unless a test hands in others. */
  compress?: (bytes: Bytes) => Promise<Uint8Array>;
  expand?: (bytes: Bytes) => Promise<Uint8Array>;
}

/** What keeping a result came to. */
export type KeepOutcome =
  /** Kept. `jsonBytes` is the result as JSON, `packedBytes` that JSON compressed, `storedChars` the characters now in the
   * storage for it, keys and head included (Chrome counts two bytes for each), and `keys` how many keys hold them. */
  | { kept: true; jsonBytes: number; packedBytes: number; storedChars: number; keys: number }
  /** Not kept, and nothing of it is in the storage. The result kept before it is gone as well. `reason` is "too-large"
   * when it is over one of the limits above or the browser says the storage is full; "unavailable" when the page has no
   * session storage; "superseded" when a later `keep` or `forget` was called before this one had finished, which the
   * page need not say; "failed" for anything else. `message` says which, in a sentence. */
  | { kept: false; reason: "too-large" | "unavailable" | "superseded" | "failed"; message: string };

/** What taking the kept result back came to. */
export type TakeBackOutcome =
  /** The result as it was kept, and the time it was complete. It stays kept: the next refresh finds it again. */
  | { found: true; result: AnalysisResult; received: Date }
  /** Nothing to show. "nothing-kept" is a page without a kept result. "unavailable" is a page without session storage.
   * "superseded" means `keep` or `forget` was called while this was reading. For every other reason something was kept
   * and has been removed: it was another version's or another Anaplan tab's, a part was missing, it could not be read
   * back, or it was not a result. The page shows none of these: it is a page on which nothing was kept. */
  | { found: false; reason: "nothing-kept" | "unavailable" | "superseded" | "other-version" | "other-tab" | "incomplete" | "damaged" | "not-a-result"; message: string };

type NotKept = Extract<KeepOutcome, { kept: false }>;
type NotFound = Extract<TakeBackOutcome, { found: false }>;
const notKept = (reason: NotKept["reason"], message: string): NotKept => ({ kept: false, reason, message });
const nothing = (reason: NotFound["reason"], message: string): NotFound => ({ found: false, reason, message });

/** What the head says about the parts. */
interface Head {
  version: string;
  /** The Anaplan tab's ID. */
  tab: number;
  /** When the result was complete, as Date.getTime gives it. */
  received: number;
  /** How many compressed bytes the parts hold, and their CRC-32. */
  bytes: number;
  crc: number;
}

const whole = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
/** The furthest a time can be from 1970, in milliseconds: beyond it a Date is no time. */
const MAX_TIME = 8.64e15;

/** The head as it was written, or undefined when what the key holds is not one. */
function readHead(written: string): Head | undefined {
  let value: unknown;
  try { value = JSON.parse(written); } catch { return undefined; }
  if (!value || typeof value !== "object") return undefined;
  const { version, tab, received, bytes, crc } = value as Partial<Record<keyof Head, unknown>>;
  return typeof version === "string" && whole(tab) && typeof received === "number" && Number.isInteger(received) && Math.abs(received) <= MAX_TIME
    && whole(bytes) && whole(crc) ? { version, tab, received, bytes, crc } : undefined;
}

/** Whether what was read back is a result, as far as the page itself checks one the tab sends: its summary and its tables
 * are lists, and every table has a list of headers and a list of rows that are lists. That is connection.ts' `isResult`,
 * which that file keeps to itself, and its check of the rows a "rows" message brings. The page showed the result before
 * it was kept, so this asks no more of it than the page did, and it leaves the result as it is: a field this file does
 * not know comes back with the rest. */
function isResult(value: unknown): value is AnalysisResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<AnalysisResult>;
  return Array.isArray(result.summary) && Array.isArray(result.tables)
    && result.tables.every(table => !!table && typeof table === "object" && Array.isArray(table.headers) && Array.isArray(table.rows) && table.rows.every(Array.isArray));
}

/** Removes every key of the module's. The head goes first, so that what is left while the rest goes is never a result. */
function clear(storage: KeptStorage): void {
  storage.removeItem(HEAD_KEY);
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key?.startsWith(KEPT_PREFIX)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}

/** Whether the storage holds a key of the module's: the head, or a part. */
function holdsKept(storage: KeptStorage): boolean {
  for (let index = 0; index < storage.length; index++) if (storage.key(index)?.startsWith(KEPT_PREFIX)) return true;
  return false;
}

/** Bytes through one of the browser's compression streams, which take them whole and give them back in pieces. */
async function through(stream: CompressionStream | DecompressionStream, bytes: Bytes): Promise<Bytes> {
  const source = new ReadableStream<Bytes>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const reader = source.pipeThrough(stream).getReader();
  const pieces: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pieces.push(value);
    size += value.byteLength;
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const piece of pieces) {
    out.set(piece, at);
    at += piece.byteLength;
  }
  return out;
}
const gzip = (bytes: Bytes): Promise<Bytes> => through(new CompressionStream("gzip"), bytes);
const gunzip = (bytes: Bytes): Promise<Bytes> => through(new DecompressionStream("gzip"), bytes);

const megabytes = (bytes: number): string => `${(bytes / 1_000_000).toFixed(1)} MB`;
const said = (error: unknown): string => (error instanceof Error ? error.message : String(error));
/** What a browser throws when a write would take the storage over what it is given. */
const isFull = (error: unknown): boolean => !!error && typeof error === "object" && (error as { name?: unknown }).name === "QuotaExceededError";

const TOO_LARGE = "This result is too large to keep across a refresh";
const NOT_KEPT = "This result is not kept across a refresh";
const NO_STORAGE = "the tab's session storage is not available";
const REMOVED = "It was removed.";

export class ResultKeeper {
  /** Counts the calls that change what is kept. A call that waited, for the compression or the expansion, and then finds a
   * later one was made leaves the storage alone: it is the later call's. So the last result handed over is the one kept,
   * however long each takes to compress. */
  private turn = 0;

  constructor(private readonly options: KeeperOptions) {}

  private get version(): string {
    return this.options.version ?? VERSION;
  }

  /** The storage: the one handed in, or the tab's session storage. Undefined where there is none, or where reading it is
   * refused, which a browser does by throwing. */
  private storage(): KeptStorage | undefined {
    if (this.options.storage) return this.options.storage;
    try {
      return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
    } catch {
      return undefined;
    }
  }

  /** Keeps `result` and the time it was complete, in the place of whatever was kept before. The earlier result goes at
   * once, and the JSON is written at once: what is kept is the result as it was handed over, whatever happens to it while
   * it is being compressed. */
  async keep(result: AnalysisResult, received: Date): Promise<KeepOutcome> {
    const turn = ++this.turn;
    try {
      const storage = this.storage();
      if (!storage) return notKept("unavailable", `${NOT_KEPT}: ${NO_STORAGE}.`);
      clear(storage);
      const { tabId } = this.options;
      // A tab ID the head could not hold would be written and then not read back.
      if (!whole(tabId)) return notKept("failed", `${NOT_KEPT}: the page's address names no Anaplan tab.`);
      const time = received.getTime();
      if (!Number.isFinite(time)) return notKept("failed", `${NOT_KEPT}: the time it was complete at is not a time.`);
      const json: unknown = JSON.stringify(result);
      if (typeof json !== "string") return notKept("failed", `${NOT_KEPT}: it cannot be written as JSON.`);
      // UTF-8 takes at least a byte for a character, so JSON with more characters than the limit is not encoded to find out.
      const plain = json.length > MAX_JSON_BYTES ? undefined : new TextEncoder().encode(json);
      if (!plain || plain.length > MAX_JSON_BYTES) return notKept("too-large", `${TOO_LARGE}: as JSON it is over ${megabytes(MAX_JSON_BYTES)}.`);
      const packed = await (this.options.compress ?? gzip)(plain);
      if (turn !== this.turn) return notKept("superseded", "A later result, or forgetting, took this result's place before it was kept.");
      if (packed.length > MAX_PACKED_BYTES) {
        return notKept("too-large", `${TOO_LARGE}: compressed it is ${megabytes(packed.length)}, and at most ${megabytes(MAX_PACKED_BYTES)} is kept.`);
      }
      const text = bytesToText(packed);
      const head: Head = { version: this.version, tab: tabId, received: time, bytes: packed.length, crc: crc32(packed) };
      const written = JSON.stringify(head);
      try {
        let parts = 0;
        for (let start = 0; start < text.length; start += PART_CHARS) storage.setItem(partKey(parts++), text.slice(start, start + PART_CHARS));
        // The head goes last: until it is there, nothing counts as kept.
        storage.setItem(HEAD_KEY, written);
        let keyChars = HEAD_KEY.length;
        for (let index = 0; index < parts; index++) keyChars += partKey(index).length;
        return { kept: true, jsonBytes: plain.length, packedBytes: packed.length, storedChars: text.length + written.length + keyChars, keys: parts + 1 };
      } catch (error) {
        // Never a part of a result: what was written before the storage refused goes again.
        clear(storage);
        return isFull(error)
          ? notKept("too-large", `${TOO_LARGE}: the tab's session storage is full (${said(error)}).`)
          : notKept("failed", `${NOT_KEPT}: the tab's session storage refused it (${said(error)}).`);
      }
    } catch (error) {
      return notKept("failed", `${NOT_KEPT}: keeping it failed (${said(error)}).`);
    }
  }

  /** The kept result and its time, for a page that has just loaded. Whatever is kept and cannot be given back is removed. */
  async takeBack(): Promise<TakeBackOutcome> {
    const turn = this.turn;
    const superseded = (): NotFound => nothing("superseded", "A later result, or forgetting, took the kept result's place while it was read.");
    try {
      const storage = this.storage();
      if (!storage) return nothing("unavailable", `Nothing is kept: ${NO_STORAGE}.`);
      const discard = (reason: NotFound["reason"], message: string): NotFound => {
        clear(storage);
        return nothing(reason, `${message} ${REMOVED}`);
      };
      const written = storage.getItem(HEAD_KEY);
      if (written === null) {
        // Parts without a head are what a write that did not finish left behind.
        clear(storage);
        return nothing("nothing-kept", "No result is kept for this page.");
      }
      const head = readHead(written);
      if (!head) return discard("damaged", "The kept result's head cannot be read.");
      if (head.version !== this.version) return discard("other-version", `The kept result is Cardigan ${head.version}'s, and this is Cardigan ${this.version}.`);
      const { tabId } = this.options;
      if (head.tab !== tabId) return discard("other-tab", `The kept result came from Anaplan tab ${head.tab}, and this page is for ${tabId === undefined ? "none" : `tab ${tabId}`}.`);
      const parts: string[] = [];
      const count = Math.ceil(textLength(head.bytes) / PART_CHARS);
      for (let index = 0; index < count; index++) {
        const part = storage.getItem(partKey(index));
        if (part === null) return discard("incomplete", `The kept result lacks part ${index + 1} of ${count}.`);
        parts.push(part);
      }
      const packed = textToBytes(parts.join(""), head.bytes);
      if (!packed || crc32(packed) !== head.crc) return discard("damaged", "The kept result's parts do not hold what its head says.");
      let json: string;
      try {
        json = new TextDecoder("utf-8", { fatal: true }).decode(await (this.options.expand ?? gunzip)(packed));
      } catch (error) {
        return turn !== this.turn ? superseded() : discard("damaged", `The kept result could not be expanded (${said(error)}).`);
      }
      if (turn !== this.turn) return superseded();
      let value: unknown;
      try { value = JSON.parse(json); } catch (error) { return discard("damaged", `The kept result is not JSON (${said(error)}).`); }
      if (!isResult(value)) return discard("not-a-result", "What was kept is not a result.");
      return { found: true, result: value, received: new Date(head.received) };
    } catch (error) {
      return nothing("unavailable", `Nothing is given back: the tab's session storage failed (${said(error)}).`);
    }
  }

  /** Forgets the kept result, and stops a `keep` that has not finished from keeping its own. True when the kept result is
   * gone: the storage was looked through after the removal, and it holds no key of the module's. False when that cannot be
   * said: the page has no session storage or may not read it, the storage refused a removal, or one of the keys is still
   * there. The result may then still be kept, and a refresh may bring it back. */
  forget(): boolean {
    this.turn++;
    try {
      const storage = this.storage();
      if (!storage) return false;
      clear(storage);
      // A storage may also leave a key where it is without saying so: what it holds now decides.
      return !holdsKept(storage);
    } catch {
      // The storage refused a removal, or could not be looked through.
      return false;
    }
  }
}
