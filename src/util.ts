/** Patterns and helpers the analyzer's files share. This file has no imports and does nothing when loaded: it is bundled
 * into both content.js (the isolated world) and model-export.js (the page's main world). */

/** An Anaplan host name. A cross-host read, a socket redirect and a socket close reason are all checked against it. */
export const ANAPLAN_HOST = /^[a-z0-9.-]+\.anaplan\.com$/i;
/** A workspace or model ID. */
export const SCOPE_ID = /^[0-9A-Za-z]{32}$/;

/** `value` as part of a file name; `fallback` when nothing of it is left. */
export function fileSafe(value: string, fallback: string): string {
  return value.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || fallback;
}
