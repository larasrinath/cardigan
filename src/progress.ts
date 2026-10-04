import { textOf } from "./result-plain.js";

/** How a run says what it is doing: the step it is on, and lines for the diagnostic log. Whoever starts the run stamps each
 * line with its time (details.ts `stampLine`) and shows or sends both. And how it says why it failed. */

export type Log = (line: string) => void;
export interface Progress { status(text: string): void; log: Log }

/** What a run asks before each further read: it throws once the run was asked to stop. An AbortSignal is one. */
export type Stop = Pick<AbortSignal, "throwIfAborted">;

/** Why a run failed, as its user is told: `message` is what the results page shows, in plain words: what happened and what
 * to do next. The codes, status numbers and counts a developer asks for are the `detail`, which goes to the diagnostic
 * log instead (when there is none, the message does). */
export class Failure extends Error {
  constructor(message: string, readonly detail?: string) { super(message); }
}

/** What to do next, in the words every message uses for it. The second names the button beside the log on the results page. */
export const REFRESH = "Refresh the Anaplan tab, then click the Cardigan icon again.";
export const SEND_LOG = "If it keeps happening, choose Copy diagnostic log and send the log.";

/** What the user is told when a run fails with anything that is not a Failure: such an error's own text was not written
 * for them, and is the detail. */
export const UNEXPECTED = `Cardigan ran into a problem it did not expect. Choose Run again. ${SEND_LOG}`;
export const failureOf = (error: unknown): Failure => (error instanceof Failure ? error : new Failure(UNEXPECTED, textOf(error instanceof Error ? error.message : error)));
