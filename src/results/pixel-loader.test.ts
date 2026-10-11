import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseMarkup } from "./dom.test-support.js";
import { ElapsedTimer, formatElapsed, pixelDelay, pixelGridHtml, SpinnerWords } from "./pixel-loader.js";
import * as spinnerWords from "./spinner-words.js";
import { ENGINE_WORDS, WORD_PACE_MS, WORD_POOLS, type WordPool } from "./spinner-words.js";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Spinner word rotation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  it.each<[WordPool, string, number]>([
    ["opening", "Waiting for the model to open…", 1500],
    ["time", "Reading Model Calendar…", 500],
    ["lists", "Reading General Lists…", 500],
    ["modules", "Reading Line Items…", 1500],
    ["actions", "Reading Import mappings…", 1500],
    ["pages", "Reading page 1 of 40: Demand board", 1500],
    ["finishing", "Building the report…", 500],
  ])("rotates %s at its own pace", (pool, status, pace) => {
    expect(WORD_PACE_MS[pool]).toBe(pace);
    const show = vi.fn();
    const words = new SpinnerWords(show);
    words.update(status);
    expect(show).toHaveBeenLastCalledWith(WORD_POOLS[pool][0]);
    for (let tick = 0; tick < 4; tick++) {
      const previous = show.mock.lastCall![0];
      vi.advanceTimersByTime(pace - 1);
      expect(show).toHaveBeenCalledTimes(tick + 1);
      vi.advanceTimersByTime(1);
      expect(show).toHaveBeenCalledTimes(tick + 2);
      expect(WORD_POOLS[pool]).toContain(show.mock.lastCall![0]);
      expect(show.mock.lastCall![0]).not.toBe(previous);
    }
    expect(vi.getTimerCount()).toBe(1);
  });

  it("keeps its clock across statuses within a pool", () => {
    const show = vi.fn();
    const words = new SpinnerWords(show);
    words.update("Reading Modules…");
    expect(show).toHaveBeenLastCalledWith("Reading the blueprint…");
    vi.advanceTimersByTime(WORD_PACE_MS.modules - 1);
    expect(show).toHaveBeenCalledTimes(1);
    words.update("Reading Line Items…");
    expect(show).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(show).toHaveBeenLastCalledWith("Untangling formulas…");
    vi.mocked(Math.random).mockReturnValue(0.99);
    vi.advanceTimersByTime(WORD_PACE_MS.modules - 1);
    expect(show).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(show).toHaveBeenLastCalledWith("Weighing calculation effort…");
    expect(show).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("picks randomly from the current pool without repeating the previous word over many ticks", () => {
    const show = vi.fn();
    const words = new SpinnerWords(show);
    words.update("Reading Modules…");
    vi.advanceTimersByTime(2 * WORD_PACE_MS.modules);
    expect(show.mock.calls).toEqual([
      ["Reading the blueprint…"], ["Untangling formulas…"], ["Reading the blueprint…"],
    ]);
    for (let tick = 0; tick < 100; tick++) {
      vi.mocked(Math.random).mockReturnValue([0, 0.5, 0.99][tick % 3]);
      const previous = show.mock.lastCall![0];
      vi.advanceTimersByTime(WORD_PACE_MS.modules);
      expect(show).toHaveBeenCalledTimes(tick + 4);
      expect(WORD_POOLS.modules).toContain(show.mock.lastCall![0]);
      expect(show.mock.lastCall![0]).not.toBe(previous);
    }
  });

  it("alternates a two-word pool", () => {
    vi.spyOn(spinnerWords, "wordsForPool").mockReturnValue(["Connecting the plans…", "Drawing the model map…"]);
    const show = vi.fn();
    const words = new SpinnerWords(show);
    words.update("Building the report…", "model");
    for (let tick = 1; tick <= 20; tick++) vi.advanceTimersByTime(WORD_PACE_MS.finishing);
    expect(show.mock.calls).toEqual(Array.from({ length: 21 }, (_, index) => [WORD_POOLS.finishing[index % 2]]));
  });

  it("holds a one-word pool", () => {
    vi.spyOn(spinnerWords, "wordsForPool").mockReturnValue(["Connecting the plans…"]);
    const show = vi.fn();
    const words = new SpinnerWords(show);
    words.update("Building the report…", "app");
    vi.advanceTimersByTime(20 * WORD_PACE_MS.finishing);
    expect(show.mock.calls).toEqual([["Connecting the plans…"]]);
  });

  it.each([
    ["Reading Modules…", "Reading Time Ranges…", "time", 1499, 500],
    ["Reading Time Ranges…", "Reading Modules…", "modules", 499, 1500],
  ] as const)("switches from %s to %s immediately and starts the new pace then", (before, after, pool, elapsed, pace) => {
    const show = vi.fn();
    const words = new SpinnerWords(show);
    words.update(before);
    vi.advanceTimersByTime(elapsed);
    words.update(after);
    expect(show).toHaveBeenCalledTimes(2);
    expect(WORD_POOLS[pool]).toContain(show.mock.lastCall![0]);
    vi.advanceTimersByTime(pace - 1);
    expect(show).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(show).toHaveBeenCalledTimes(3);
    expect(WORD_POOLS[pool]).toContain(show.mock.lastCall![0]);
    expect(vi.getTimerCount()).toBe(1);
  });

  it.each(["stop", "run ends"])("clears the timer when %s and starts a new run afresh", end => {
    const show = vi.fn();
    const words = new SpinnerWords(show);
    words.update("Building the report…", "app");
    expect(vi.getTimerCount()).toBe(1);
    if (end === "stop") words.stop();
    else words.update(undefined);
    expect(show).toHaveBeenLastCalledWith("");
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(20 * WORD_PACE_MS.finishing);
    expect(show).toHaveBeenCalledTimes(2);
    words.update("Building the report…", "app");
    expect(show).toHaveBeenLastCalledWith("Connecting the plans…");
    expect(show).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("shows one word per exact step with reduced motion, including steps within the same pool", () => {
    const show = vi.fn();
    const words = new SpinnerWords(show);
    words.update("Reading Modules…", "model", true);
    vi.advanceTimersByTime(20 * WORD_PACE_MS.modules);
    words.update("Reading Modules…", "model", true);
    expect(show).toHaveBeenCalledTimes(1);
    words.update("Reading Line Items…", "model", true);
    expect(show).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    words.update("Reading Line Items…", "model", false);
    vi.advanceTimersByTime(WORD_PACE_MS.modules);
    expect(show).toHaveBeenCalledTimes(3);
    words.update("Reading Line Items…", "model", true);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(20 * WORD_PACE_MS.modules);
    expect(show).toHaveBeenCalledTimes(3);
  });

  it.each(["Classic", "Polaris"] as const)("adds both %s phrases only after its engine line, remembers them and forgets them for a new run", engine => {
    vi.mocked(Math.random).mockReturnValue(0.99);
    const show = vi.fn();
    const words = new SpinnerWords(show);
    words.log(["14:02:05 Engine: unknown (no Classic client)", `14:02:05 page: Engine: ${engine}`]);
    words.update("Building the report…", "app");
    vi.advanceTimersByTime(20 * WORD_PACE_MS.finishing);
    for (const [word] of show.mock.calls) {
      expect(Object.values(ENGINE_WORDS).flat()).not.toContain(word);
      expect(["Drawing the model map…", "Drawing the arrows…"]).not.toContain(word);
    }
    words.log([`14:02:06 Engine: ${engine} (from the Line Items columns)`]);
    words.log(["14:03:00 Names read"]);
    show.mockClear();
    for (let tick = 0; tick < 4; tick++) vi.advanceTimersByTime(WORD_PACE_MS.finishing);
    expect(show.mock.calls).toEqual([
      [ENGINE_WORDS[engine][1]], [ENGINE_WORDS[engine][0]], [ENGINE_WORDS[engine][1]], [ENGINE_WORDS[engine][0]],
    ]);
    words.stop();
    words.log([]);
    words.update("Building the report…", "model");
    expect(show).toHaveBeenLastCalledWith("Drawing the arrows…");
    vi.advanceTimersByTime(WORD_PACE_MS.finishing);
    expect(show).toHaveBeenLastCalledWith("Almost there…");
    expect(show).toHaveBeenCalledTimes(7);
  });

  it("waits for Finishing even when the engine is already known, and keeps reduced motion still when it becomes known", () => {
    vi.mocked(Math.random).mockReturnValue(0.99);
    const show = vi.fn();
    const words = new SpinnerWords(show);
    words.log(["Engine: Classic"]);
    words.update("Reading Line Items…");
    vi.advanceTimersByTime(4 * WORD_PACE_MS.modules);
    for (const [word] of show.mock.calls) expect(WORD_POOLS.modules).toContain(word);
    words.update("Building the report…", "model", true);
    expect(show).toHaveBeenLastCalledWith("Riding the Hyperblock…");
    words.stop();
    words.log([]);
    words.update("Building the report…", "model", true);
    expect(show).toHaveBeenLastCalledWith("Drawing the arrows…");
    show.mockClear();
    words.log(["Engine: Polaris"]);
    words.update("Building the report…", "model", true);
    vi.advanceTimersByTime(20 * WORD_PACE_MS.finishing);
    expect(show).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
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
