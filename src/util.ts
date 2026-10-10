/** Patterns and helpers the analyzer's files share. This file has no imports and does nothing when loaded: it is bundled
 * into both content.js (the isolated world) and model-export.js (the page's main world). */

/** An Anaplan host name. A cross-host read, a socket redirect and a socket close reason are all checked against it. */
export const ANAPLAN_HOST = /^[a-z0-9.-]+\.anaplan\.com$/i;
/** A workspace or model ID as the analyzer has always accepted it in page paths and messages: 32 letters or digits. This is
 * looser than 32 hexadecimal digits and is kept as it was. */
export const SCOPE_ID = /^[0-9A-Za-z]{32}$/;

// Page definitions, socket payloads and described cards are JSON of no fixed shape; fields are read defensively.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Obj = Record<string, any>;
export const list = (value: unknown): Obj[] => (Array.isArray(value) ? value.filter(item => item && typeof item === "object") : []);
export const text = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);
export const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** A time a step took, for the diagnostic log: seconds with two decimals, "0.62 s". */
export const seconds = (ms: number): string => `${(Math.max(0, ms) / 1000).toFixed(2)} s`;

/** The times of the steps of a run, for one line of the diagnostic log, which a live run's reader looks at first:
 * "Time: names 1.20 s, line items 0.84 s". `step` times what it is given and keeps its time; `line` says them all. */
export function stepTimes(): { step: <T>(what: string, work: () => Promise<T>) => Promise<T>; line: () => string } {
  const times: string[] = [];
  return {
    step: async (what, work) => {
      const from = Date.now();
      const done = await work();
      times.push(`${what} ${seconds(Date.now() - from)}`);
      return done;
    },
    line: () => `Time: ${times.join(", ")}`,
  };
}

/** As many reads as a run keeps moving at a time, wherever it reads a list of things one by one: pages, apps, modules' line
 * items, items' names, saved views. Anaplan is asked for no more than that at once. */
export const AT_A_TIME = 4;

/** Runs `work` on each item, at most `limit` at a time, starting them in the items' order: as soon as one ends, the next
 * starts, so a slow item holds up only its own place. Once `signal` has stopped the run, no further item starts; the work
 * under way is let end, and the run then ends with the stop's reason, so that nothing it started is still going after it.
 * Once the work on one item has failed, no further item starts either, and the run ends at once with that failure. */
export async function eachAtMost<T>(items: readonly T[], limit: number, signal: AbortSignal | undefined, work: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  let failed = false;
  const lane = async (): Promise<void> => {
    while (next < items.length && !failed && !signal?.aborted) {
      const index = next++;
      try {
        await work(items[index], index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, lane));
  signal?.throwIfAborted();
}

/** `value` as part of a file name; `fallback` when nothing of it is left. */
export function fileSafe(value: string, fallback: string): string {
  return value.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || fallback;
}
