/** How a run says what it is doing: the step it is on, and lines for the diagnostic log. Whoever starts the run stamps each
 * line with its time (details.ts `stampLine`) and shows or sends both. */

export type Log = (line: string) => void;
export interface Progress { status(text: string): void; log: Log }

/** What a run asks before each further read: it throws once the run was asked to stop. An AbortSignal is one. */
export type Stop = Pick<AbortSignal, "throwIfAborted">;
