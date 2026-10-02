/** Patterns and helpers the analyzer's files share. This file has no imports and does nothing when loaded: it is bundled
 * into both content.js (the isolated world) and model-export.js (the page's main world). */

/** An Anaplan host name. A cross-host read, a socket redirect and a socket close reason are all checked against it. */
export const ANAPLAN_HOST = /^[a-z0-9.-]+\.anaplan\.com$/i;
/** A workspace or model ID as the analyzer has always accepted it in page paths and messages: 32 letters or digits. This is
 * looser than SAM's own 32-hexadecimal ANAPLAN_ID (src/access/anaplan-id.ts) and is kept as it was. */
export const SCOPE_ID = /^[0-9A-Za-z]{32}$/;

// Page definitions, socket payloads and described cards are JSON of no fixed shape; fields are read defensively.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Obj = Record<string, any>;
export const list = (value: unknown): Obj[] => (Array.isArray(value) ? value.filter(item => item && typeof item === "object") : []);
export const text = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);
export const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** `value` as part of a file name; `fallback` when nothing of it is left. */
export function fileSafe(value: string, fallback: string): string {
  return value.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || fallback;
}
