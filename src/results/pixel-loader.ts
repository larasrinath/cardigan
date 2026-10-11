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
