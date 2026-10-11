import { describe, expect, it } from "vitest";
import { spreadLine, spreadOf } from "./nav-spread.js";

/** A line of the navigation as the browser lays it out: its items, each of a width, and the properties the page sets on it. */
function line(widths: readonly number[], withStyle = true) {
  const set = new Map<string, string>();
  const style = withStyle ? { setProperty: (name: string, value: string) => void set.set(name, value) } : {};
  const children = widths.map(width => ({ getBoundingClientRect: () => ({ width }) }));
  return { list: { children, style } as unknown as HTMLElement, set };
}

describe("The navigation's line, spread over its width", () => {
  it("is told its items' widths in all and the gaps between them", () => {
    expect(spreadOf([95.25, 136.5, 79.25])).toEqual({ need: 311, gaps: 2 });
    // Nothing to spread: no item, one item, or items that have no width, as on a line that is hidden.
    expect([spreadOf([]), spreadOf([120]), spreadOf([0, 0, 0])]).toEqual([undefined, undefined, undefined]);
  });

  it("sets the two on the line for its stylesheet, and keeps what it set where the line is not laid out", () => {
    const shown = line([95.25, 136.5, 79.25, 104.5]);
    spreadLine(shown.list);
    expect([...shown.set]).toEqual([["--nav-need", "415.5px"], ["--nav-gaps", "3"]]);
    // A hidden line has no widths: nothing is set, and what was set stays until the line is laid out again.
    const hidden = line([0, 0, 0, 0]);
    spreadLine(hidden.list);
    expect([...hidden.set]).toEqual([]);
    // A page that lays nothing out and sets no style, as the stand-in page of the tests, is left as it is.
    expect(() => spreadLine(line([95, 136], false).list)).not.toThrow();
  });
});
