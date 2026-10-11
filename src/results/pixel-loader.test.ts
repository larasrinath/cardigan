import { afterEach, describe, expect, it, vi } from "vitest";
import { parseMarkup } from "./dom.test-support.js";
import { ElapsedTimer, formatElapsed, pixelDelay, pixelGridHtml } from "./pixel-loader.js";

afterEach(() => vi.useRealTimers());

describe("The Drive loader", () => {
  it("delays all nine cells as a chevron driving right, in both sizes", () => {
    const delays = [90, 180, 270, 0, 90, 180, 90, 180, 270];
    expect(delays.map((_, index) => pixelDelay(index))).toEqual(delays);
    for (const small of [false, true]) {
      const grid = parseMarkup(pixelGridHtml(small)).querySelector(".pixel-grid")!;
      expect(grid.getAttribute("aria-hidden")).toBe("true");
      expect(grid.classList.contains("pixel-grid-small")).toBe(small);
      expect(grid.children.map(cell => cell.getAttribute("style"))).toEqual(delays.map(delay => `animation-delay:${delay}ms`));
      expect(grid.textContent).toBe("");
    }
  });

  it.each([
    [0, "0.0s"], [9.9, "9.9s"], [59.9, "59.9s"], [60, "1m 0.0s"], [61.2, "1m 1.2s"], [3725, "62m 5.0s"],
    [59.999, "59.9s"], [60.099, "1m 0.0s"],
  ])("formats %s elapsed seconds as %s", (seconds, text) => {
    expect(formatElapsed(seconds * 1000)).toBe(text);
  });

  it("ticks every 100 ms, retains its start across statuses, stops and starts afresh", () => {
    vi.useFakeTimers();
    const show = vi.fn();
    const timer = new ElapsedTimer(show);
    timer.update(false);
    expect(show).not.toHaveBeenCalled();
    timer.update(true);
    expect(show).toHaveBeenLastCalledWith("0.0s");
    vi.advanceTimersByTime(99);
    expect(show).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(show).toHaveBeenLastCalledWith("0.1s");
    timer.update(true);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1100);
    expect(show).toHaveBeenLastCalledWith("1.2s");
    timer.update(false);
    expect(vi.getTimerCount()).toBe(0);
    show.mockClear();
    vi.advanceTimersByTime(1000);
    expect(show).not.toHaveBeenCalled();
    timer.update(true);
    expect(show).toHaveBeenLastCalledWith("0.0s");
    timer.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
