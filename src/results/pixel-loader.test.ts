import { afterEach, describe, expect, it, vi } from "vitest";
import { parseMarkup } from "./dom.test-support.js";
import { ElapsedTimer, formatElapsed, pixelDelay, pixelGridHtml, SpinnerWords } from "./pixel-loader.js";
import { WORD_POOLS } from "./spinner-words.js";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Spinner word rotation", () => {
  it("chooses randomly every three seconds, excludes the last two and switches pools immediately", () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    const show = vi.fn();
    const words = new SpinnerWords(show);
    words.update("Reading Modules…");
    expect(show).toHaveBeenLastCalledWith("Reading the blueprint…");
    vi.advanceTimersByTime(2999);
    expect(show).toHaveBeenCalledTimes(1);
    words.update("Reading Line Items…");
    expect(show).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(show).toHaveBeenLastCalledWith("Untangling formulas…");
    random.mockReturnValue(0.99);
    vi.advanceTimersByTime(3000);
    expect(show).toHaveBeenLastCalledWith("Counting cells…");
    for (let tick = 0; tick < 30; tick++) vi.advanceTimersByTime(3000);
    const shown = show.mock.calls.map(([word]) => word);
    shown.forEach((word, index) => expect(shown.slice(Math.max(0, index - 2), index)).not.toContain(word));
    words.update("Reading Time Ranges…");
    expect(WORD_POOLS.time).toContain(show.mock.lastCall![0]);
    const calls = show.mock.calls.length;
    vi.advanceTimersByTime(2999);
    expect(show).toHaveBeenCalledTimes(calls);
    vi.advanceTimersByTime(1);
    expect(show).toHaveBeenCalledTimes(calls + 1);
    words.stop();
    expect(show).toHaveBeenLastCalledWith("");
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(9000);
    expect(show).toHaveBeenCalledTimes(calls + 2);
  });

  it("shows one word per exact step with reduced motion, including steps within the same pool", () => {
    vi.useFakeTimers();
    const show = vi.fn();
    const words = new SpinnerWords(show);
    words.update("Reading Modules…", "model", true);
    vi.advanceTimersByTime(9000);
    words.update("Reading Modules…", "model", true);
    expect(show).toHaveBeenCalledTimes(1);
    words.update("Reading Line Items…", "model", true);
    expect(show).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    words.update("Reading Line Items…", "model", false);
    vi.advanceTimersByTime(3000);
    expect(show).toHaveBeenCalledTimes(3);
    words.update("Reading Line Items…", "model", true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["Classic", "Polaris"])("adds %s only after its engine line, remembers it and forgets it for a new run", engine => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const show = vi.fn();
    const words = new SpinnerWords(show);
    words.log(["14:02:05 Engine: unknown (no Classic client)", `14:02:05 page: Engine: ${engine}`]);
    words.update("Building the report…", "app");
    vi.advanceTimersByTime(9000);
    expect(show.mock.calls).toEqual([["Connecting the plans…"]]);
    words.log([`14:02:06 Engine: ${engine} (from the Line Items columns)`]);
    words.log(["14:03:00 Names read"]);
    vi.advanceTimersByTime(3000);
    expect(show).toHaveBeenLastCalledWith(engine === "Classic" ? "Hyperblocking…" : "Polarising…");
    vi.advanceTimersByTime(9000);
    expect(show).toHaveBeenCalledTimes(2);
    words.stop();
    words.log([]);
    words.update("Building the report…", "model");
    expect(show).toHaveBeenLastCalledWith("Drawing the model map…");
    vi.advanceTimersByTime(9000);
    expect(show).toHaveBeenLastCalledWith("Connecting the plans…");
    expect(show).toHaveBeenCalledTimes(5);
  });
});

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
