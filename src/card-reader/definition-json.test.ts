import { describe, expect, it } from "vitest";
import { copyDocument, NATIVE_CARD_TYPES } from "./definition-json.js";
import { UxDefinitionError } from "./definition-types.js";

// The editor's entry points (definition-editor.test.ts) and the card reader (card-details.test.ts) pin the bounded copy
// through their own calls. This file holds what neither caller can show.

const errorText = (fn: () => unknown, code: string, message: string) => {
  try { fn(); throw new Error("Expected a definition error"); } catch (error) { expect(error).toBeInstanceOf(UxDefinitionError); expect(error).toMatchObject({ code, message }); }
};

describe("bounded page-definition JSON", () => {
  it("knows exactly the thirteen native card types", () => {
    // Written out here, not imported: a type added to or dropped from the shared list must fail a test.
    expect([...NATIVE_CARD_TYPES].sort()).toEqual(["ACTION", "CARD", "COMBOCHART", "FIELD", "HIERARCHY", "IMAGE", "MAP", "NETWORK", "PRESENTATION_TABLE",
      "SHAPE", "TABLE", "TEXT", "WEB_XL"]);
  });

  it("counts string characters during the copy only when boundStringsEarly is true", () => {
    // 8,000,001 characters of strings, then an unsafe key.
    const page = () => ({ first: "x".repeat(4_000_000), second: "x".repeat(4_000_001), extra: JSON.parse('{"__proto__":{"polluted":true}}') });
    errorText(() => copyDocument(page(), { boundStringsEarly: true }), "DEFINITION_TOO_LARGE", "Page definition exceeds SAM's 8 MB character bound.");
    for (const options of [undefined, {}, { boundStringsEarly: false }]) {
      errorText(() => copyDocument(page(), options), "UNSUPPORTED_DEFINITION", "Unsafe object key in page definition.");
    }
  });
});
