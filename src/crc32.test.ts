import { describe, expect, it } from "vitest";
import { crc32 } from "./crc32.js";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("The CRC-32 checksum", () => {
  it("computes the standard CRC-32 check value", () => {
    expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});
