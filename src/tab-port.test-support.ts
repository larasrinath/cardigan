import { PORT_NAME, type TabMessage } from "./protocol.js";

/** A stand-in for the port between the results page and the content script, seen from the content script. Tests only. */

/** The extension's own ID, as chrome.runtime.id gives it. */
export const EXTENSION = "abcdefghijklmnopabcdefghijklmnop";

/** The results page's end of a port, as the content script holds it. What is posted arrives as JSON does. */
export class FakePort {
  readonly received: TabMessage[] = [];
  /** The largest message, as JSON in UTF-8. */
  largest = 0;
  refused = false;
  /** Messages the port does not take although it is open, the way Chrome refuses one that is too large. */
  refuses: (message: TabMessage) => boolean = () => false;
  private open = true;
  private readonly listeners = { message: [] as ((message: unknown) => void)[], disconnect: [] as (() => void)[] };
  readonly onMessage = { addListener: (listener: (message: unknown) => void) => { this.listeners.message.push(listener); } };
  readonly onDisconnect = { addListener: (listener: () => void) => { this.listeners.disconnect.push(listener); } };
  /** Who opened it, as Chrome reports it; `null` stands for a port that names no sender at all. */
  readonly sender: { id?: string } | undefined;
  constructor(readonly name: string = PORT_NAME, sender: { id?: string } | null = { id: EXTENSION }) { this.sender = sender ?? undefined; }
  postMessage(message: unknown) {
    if (!this.open) throw new Error("Attempting to use a disconnected port object");
    if (this.refuses(message as TabMessage)) throw new Error("Message length exceeded maximum allowed length.");
    const json = JSON.stringify(message);
    this.largest = Math.max(this.largest, new TextEncoder().encode(json).byteLength);
    this.received.push(JSON.parse(json) as TabMessage);
  }
  disconnect() { this.refused = true; this.open = false; }
  /** The page sends a message. */
  say(message: unknown) { for (const listener of this.listeners.message) listener(message); }
  /** The page goes away: closed, reloaded, or its tab discarded. */
  close() { this.open = false; for (const listener of this.listeners.disconnect) listener(); }
  get listening() { return this.listeners.message.length + this.listeners.disconnect.length; }
  types() { return this.received.map(message => message.type); }
  /** What it was told since the last look. */
  take() { return this.received.splice(0); }
}
