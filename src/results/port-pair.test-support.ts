import { PORT_NAME } from "../protocol.js";
import { EXTENSION } from "../tab-port.test-support.js";

/** A stand-in for an Anaplan tab as the extension's messaging sees it, for tests that run both ends of the port: the
 * results page's client (connection.ts) and the content script's side (tab-port.ts). Tests only.
 *
 * It keeps to what Chrome's ports do:
 * - chrome.tabs.connect hands the page its end at once. The tab's content script is told of its end in a later turn.
 * - A message arrives as JSON, so only what JSON keeps arrives, in the order it was posted and in a later turn: posting
 *   never runs the other end's listeners.
 * - disconnect() closes the end that calls it at once and tells only the other end, after the messages posted before it.
 *   An end that is closed hears nothing more. Posting on an end that is closed, or that has heard the other close, throws;
 *   a message posted to an end that has closed meanwhile is lost.
 * - A tab without a content script closes the page's port, with Chrome's reason in chrome.runtime.lastError while the
 *   page's disconnect listeners run, and only then.
 * - A message Chrome would refuse for its size is refused: postMessage throws, and the port stays open. */

/** Runs something in a later turn of its own, after whatever was put off before it: Node's setImmediate where there is one
 * (a timer there waits a millisecond, and a run is some hundred messages), and a timer otherwise. */
const immediate = (globalThis as { setImmediate?: (run: () => void) => unknown }).setImmediate;
export const later = (run: () => void): void => { if (immediate) immediate(run); else setTimeout(run, 0); };

/** The most one message may take, as JSON in UTF-8. */
export const MESSAGE_MAX_BYTES = 64 * 1024 * 1024;
export const DISCONNECTED = "Attempting to use a disconnected port object";
export const TOO_LARGE = "Message length exceeded maximum allowed length.";
export const NOBODY = "Could not establish connection. Receiving end does not exist.";

/** One end of a port. */
export class PortEnd implements chrome.runtime.Port {
  /** Each message this end was told, as it arrived. */
  readonly heard: unknown[] = [];
  /** The largest message posted from this end, as JSON in UTF-8. */
  largest = 0;
  /** A message the port does not take from this end although it is open, the way Chrome refuses one that is too large. */
  refuses: (message: unknown) => boolean = () => false;
  /** The other end of the port. */
  other!: PortEnd;
  private isOpen = true;
  private readonly listeners = { message: [] as ((message: unknown) => void)[], disconnect: [] as (() => void)[] };
  readonly onMessage = { addListener: (listener: (message: unknown) => void): void => { this.listeners.message.push(listener); } };
  readonly onDisconnect = { addListener: (listener: () => void): void => { this.listeners.disconnect.push(listener); } };

  constructor(private readonly tab: FakeTab, readonly name: string, readonly sender: { id?: string } | undefined) {}

  get open(): boolean { return this.isOpen; }

  postMessage(message: unknown): void {
    if (!this.isOpen) throw new Error(DISCONNECTED);
    const json = JSON.stringify(message) ?? "null";
    const bytes = new TextEncoder().encode(json).byteLength;
    if (bytes > MESSAGE_MAX_BYTES || this.refuses(message)) throw new Error(TOO_LARGE);
    this.largest = Math.max(this.largest, bytes);
    this.tab.later(() => this.other.hear(JSON.parse(json) as unknown));
  }

  /** This end lets go: its page was closed or reloaded, or its tab was closed or left the page. */
  disconnect(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.tab.later(() => this.other.hearClosed(undefined));
  }

  private hear(message: unknown): void {
    if (!this.isOpen) return;
    this.heard.push(message);
    for (const listener of [...this.listeners.message]) listener(message);
  }

  /** The other end has gone, or Chrome found nobody to connect to (`reason`). */
  hearClosed(reason: string | undefined): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.tab.lastError = reason === undefined ? undefined : { message: reason };
    try {
      for (const listener of [...this.listeners.disconnect]) listener();
    } finally {
      this.tab.lastError = undefined;
    }
  }

  /** The types of the messages this end was told, in order. */
  types(): string[] {
    return this.heard.map(message => String((message as { type?: unknown } | null)?.type));
  }
}

/** One Anaplan tab: what its content script registers, and the ports results pages open to it. */
export class FakeTab {
  /** chrome.runtime.lastError as a results page reads it. */
  lastError: { message?: string } | undefined;
  /** Every port opened to the tab, as its two ends, in the order they were opened. */
  readonly ports: { page: PortEnd; tab: PortEnd }[] = [];
  private scripts: ((port: chrome.runtime.Port) => void)[] = [];
  private readonly queue: (() => void)[] = [];
  private scheduled = false;

  /** chrome.runtime as the tab's content script has it. */
  readonly runtime: Pick<typeof chrome.runtime, "id" | "onConnect"> = {
    id: EXTENSION,
    onConnect: { addListener: listener => { this.scripts.push(listener); } },
  };

  /** chrome.tabs.connect, as a results page calls it for this tab. */
  connect = (name: string = PORT_NAME): PortEnd => {
    const page = new PortEnd(this, name, undefined);
    const tab = new PortEnd(this, name, { id: EXTENSION });
    page.other = tab;
    tab.other = page;
    this.ports.push({ page, tab });
    // Whoever listens in the tab when the connection gets there is told of it; a tab where nobody listens closes the port.
    this.later(() => {
      if (!this.scripts.length) page.hearClosed(NOBODY);
      else for (const script of this.scripts) script(tab);
    });
    return page;
  };

  /** The tab is closed, reloaded or goes to another address: its content script is gone, and with it every port it held. */
  leave(): void {
    this.scripts = [];
    for (const { tab } of this.ports) tab.disconnect();
  }

  /** Runs `deliver` in a later turn, after everything that was on its way before it. One delivery a turn, so whatever the
   * receiver starts has its own turn before the next message. */
  later(deliver: () => void): void {
    this.queue.push(deliver);
    this.schedule();
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    later(() => {
      this.scheduled = false;
      const deliver = this.queue.shift();
      // Before the delivery runs, so that a listener that throws does not hold up what comes after it.
      if (this.queue.length) this.schedule();
      deliver?.();
    });
  }

  /** Resolves once nothing has been on its way between the tab and its pages for `turns` turns in a row. */
  async quiet(turns = 10): Promise<void> {
    for (let still = 0; still < turns;) {
      await new Promise(resolve => setTimeout(resolve, 0));
      still = this.queue.length || this.scheduled ? 0 : still + 1;
    }
  }
}
