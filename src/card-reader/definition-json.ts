import { UxDefinitionError } from "./definition-types.js";

/* Bounded JSON handling shared by the authoring editor (definition-editor.ts) and the read-only card reader
 * (card-details.ts). The page analyzer extension bundles the reader for the browser, so this module imports only
 * definition-types.ts: no Node API and no zod. */

type Obj = Record<string, unknown>;

// Local resource bounds, not Anaplan limits.
export const MAX_NODES = 150_000;
export const MAX_DEPTH = 40;
const MAX_CHARS = 8_000_000;
export const UNSAFE_KEYS: ReadonlySet<string> = new Set(["__proto__", "prototype", "constructor"]);
/** Native card types. The editor validates layout nodes of these types strictly; the reader only reports them. */
export const NATIVE_CARD_TYPES: ReadonlySet<string> = new Set(["TEXT", "TABLE", "CARD", "COMBOCHART", "IMAGE", "FIELD", "ACTION", "MAP", "PRESENTATION_TABLE", "SHAPE", "HIERARCHY", "NETWORK", "WEB_XL"]);

function fail(code: string, message: string): never { throw new UxDefinitionError(code, message); }
export const isObject = (value: unknown): value is Obj => value !== null && typeof value === "object" && !Array.isArray(value);

/** Copy JSON, reject prototype keys/cycles/non-JSON values, and bound hostile or accidental huge documents.
 * `boundStringsEarly` (the card reader) also counts string characters during the copy, so an oversized document stops
 * there instead of at a later fault; without it (the editor) only the serialized size is checked, after the copy. */
export function copyDocument(native: unknown, options: { boundStringsEarly?: boolean } = {}): Obj {
  let count = 0;
  let chars = 0;
  const ancestors = new Set<object>();
  const visit = (value: unknown, depth: number): unknown => {
    if (++count > MAX_NODES || depth > MAX_DEPTH) fail("DEFINITION_TOO_LARGE", "Page definition exceeds the bounded JSON traversal.");
    if (typeof value === "string") {
      if (options.boundStringsEarly && (chars += value.length) > MAX_CHARS) fail("DEFINITION_TOO_LARGE", "Page definition exceeds the 8 MB character bound.");
      return value;
    }
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "object") return fail("UNSUPPORTED_DEFINITION", "Page definitions must contain only JSON values.");
    if (ancestors.has(value)) fail("UNSUPPORTED_DEFINITION", "Cyclic page definition.");
    ancestors.add(value);
    let result: unknown;
    if (Array.isArray(value)) result = value.map(item => visit(item, depth + 1));
    else {
      if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("UNSUPPORTED_DEFINITION", "Unexpected object prototype.");
      const entries = Object.entries(value);
      if (entries.some(([key]) => UNSAFE_KEYS.has(key))) fail("UNSUPPORTED_DEFINITION", "Unsafe object key in page definition.");
      result = Object.fromEntries(entries.map(([key, item]) => [key, visit(item, depth + 1)]));
    }
    ancestors.delete(value);
    return result;
  };
  const doc = visit(native, 0);
  if (!isObject(doc)) fail("UNSUPPORTED_DEFINITION", "Page definition must be an object.");
  if (JSON.stringify(doc).length > MAX_CHARS) fail("DEFINITION_TOO_LARGE", "Page definition exceeds the 8 MB character bound.");
  return doc;
}
