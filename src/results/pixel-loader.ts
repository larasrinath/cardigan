import { poolForStatus, wordsForPool, type WordEngine, type WordPool } from "./spinner-words.js";

/** The Drive wave: the middle row leads, with the outer rows one step behind. */
export const pixelDelay = (index: number): number => (index % 3 + Math.abs(Math.floor(index / 3) - 1)) * 90;

/** Only the run card and Run again use this grid. Its cells carry no accessible text. */
export function pixelGridHtml(small = false): string {
  return `<span class="pixel-grid${small ? " pixel-grid-small" : ""}" aria-hidden="true">${Array.from({ length: 9 }, (_, index) =>
    `<span class="pixel-cell" style="animation-delay:${pixelDelay(index)}ms"></span>`).join("")}</span>`;
}

/** Elapsed milliseconds, rounded down to the last completed tenth of a second. */
export function formatElapsed(milliseconds: number): string {
  const tenths = Math.floor(Math.max(0, milliseconds) / 100);
  const seconds = ((tenths % 600) / 10).toFixed(1);
  return tenths < 600 ? `${seconds}s` : `${Math.floor(tenths / 600)}m ${seconds}s`;
}

/** One clock per run. Status changes keep its start; completion or failure clears its interval. */
export class ElapsedTimer {
  private started = 0;
  private interval: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly show: (text: string) => void) {}

  update(running: boolean): void {
    if (!running) return this.stop();
    if (this.interval === undefined) {
      this.started = performance.now();
      this.interval = setInterval(() => this.tick(), 100);
    }
    this.tick();
  }

  stop(): void {
    clearInterval(this.interval);
    this.interval = undefined;
  }

  private tick(): void {
    this.show(formatElapsed(performance.now() - this.started));
  }
}

/** One silent phrase beside the pixels. Status updates leave the rotation's clock alone within a pool. */
export class SpinnerWords {
  private interval: ReturnType<typeof setInterval> | undefined;
  private status: string | undefined;
  private pool: WordPool | undefined;
  private kind: "app" | "model" = "model";
  private engine: WordEngine | undefined;
  private recent: string[] = [];

  constructor(private readonly show: (text: string) => void) {}

  /** Keep a known engine even after its line drops out of the capped log; an empty log begins a new run. */
  log(lines: readonly string[]): void {
    if (!lines.length) { this.engine = undefined; return; }
    for (const line of lines) {
      const engine = /^(?:\d{2}:\d{2}:\d{2} )?Engine: (Classic|Polaris)\b/.exec(line)?.[1];
      if (engine === "Classic" || engine === "Polaris") this.engine = engine;
    }
  }

  update(status: string | undefined, kind: "app" | "model" = "model", reducedMotion = false): void {
    if (status === undefined) return this.stop();
    const pool = poolForStatus(status);
    const changed = pool !== this.pool || kind !== this.kind || (reducedMotion && status !== this.status);
    this.status = status;
    this.pool = pool;
    this.kind = kind;
    if (changed) {
      clearInterval(this.interval);
      this.interval = undefined;
      this.pick();
    }
    if (reducedMotion) {
      clearInterval(this.interval);
      this.interval = undefined;
    } else if (this.interval === undefined) {
      this.interval = setInterval(() => this.pick(), 3000);
    }
  }

  stop(): void {
    clearInterval(this.interval);
    this.interval = undefined;
    this.status = undefined;
    this.pool = undefined;
    this.recent = [];
    this.show("");
  }

  private pick(): void {
    if (!this.pool) return;
    const words = wordsForPool(this.pool, this.kind, this.engine).filter(word => !this.recent.includes(word));
    // Finishing can have only one or two words. Hold the last one rather than repeat either of the last two.
    if (!words.length) return;
    const word = words[Math.floor(Math.random() * words.length)];
    this.recent = [...this.recent.slice(-1), word];
    this.show(word);
  }
}
