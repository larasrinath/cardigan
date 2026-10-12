import { describe, expect, it } from "vitest";
import { LEAST_GAP, MARKED_WEIGHT, PLAIN_WEIGHT, spreadLine, spreadOf, type ItemRoom, type LineReader, type WeightedText } from "./nav-spread.js";
import { NAV_GROUPS, navItems } from "./markup.js";
import { tableLabel } from "./result-view.js";

/** The gap the stylesheet leaves between slots for a line `line` wide (results.css `.nav-list`). */
const cssGap = (slots: readonly number[], line: number): number => Math.max(1, (line - 1 - slots.reduce((sum, slot) => sum + slot, 0)) / (slots.length - 1));

/** How wide a text is written, in the stand-in for the browser: a little wider in bold. */
const textWidth = ([text, weight]: WeightedText): number => text.length * (weight === MARKED_WEIGHT ? 7.5 : 7);

/** How wide Chrome writes each word of a model's bar, plain and in bold, as measured in the built page at 1,000px wide, in
 * the headless Chrome the README's pictures are taken with (12 Oct 2026), at the page's own font: every one narrower than
 * the stand-in's letters, a long name of narrow letters most of all. Model-to-Model Imports is 148.6px in bold, where the
 * stand-in makes it 165px. Each item's own width beside its words measured as the stand-in has it: 30px for an entry and
 * 42px for a group's button. */
const CHROME_WIDTHS: ReadonlyMap<string, readonly [plain: number, bold: number]> = new Map([
  ["Overview", [52.9, 55.3]], ["Dimensions", [66.8, 68.7]], ["Model Calendar", [91.2, 93.7]], ["Time Ranges", [73.2, 75.4]], ["Versions", [47.7, 49.3]],
  ["General Lists", [72.4, 74.7]], ["Line Item Subsets", [100.5, 103.5]], ["Modules", [49.8, 51.1]], ["Line Items", [58.4, 60.3]], ["DCA", [25.6, 26.1]],
  ["Unused Line Items", [105.5, 108.5]], ["Unused Modules", [97, 99.3]], ["Actions", [42.4, 43.9]], ["Processes", [55.6, 56.8]], ["Imports", [44.4, 46.4]],
  ["File Imports", [67.4, 70.2]], ["Model-to-Model Imports", [144.1, 148.6]], ["In-Model Imports", [100.8, 104.5]], ["Data Sources", [75, 76.9]],
  ["Exports", [42.3, 44.3]], ["Other Actions", [78.9, 81.3]], ["Source Models", [85.2, 87.3]], ["App Usage", [62.8, 64.3]], ["Module Usage", [83.3, 85.4]],
  ["Page Filters", [65.4, 67.7]], ["Page Actions", [73.9, 76.2]], ["Model map", [65.9, 67.6]],
] as const);
const chromeWidth = ([text, weight]: WeightedText): number => CHROME_WIDTHS.get(text)?.[weight === MARKED_WEIGHT ? 1 : 0] ?? textWidth([text, weight]);

/** An item of the line as the browser lays it out: an entry, or a group whose button carries the texts it can show. The
 * item is as wide as the width set on it, or else as its own width beside its words, and its words as written, by
 * `measure`. */
function item(words: string, marked: boolean, labels?: readonly string[], measure = textWidth) {
  const style = new Map<string, string>();
  const own = labels ? 42 : 30;
  const shown = { textContent: words };
  const natural = () => own + measure([words, marked ? MARKED_WEIGHT : PLAIN_WEIGHT]);
  const button = {
    querySelector: (selector: string) => (selector === "span" ? shown : null),
    hasAttribute: (name: string) => name === "aria-current" && marked,
    dataset: labels ? { labels: labels.join("\n") } : {},
    getBoundingClientRect: () => ({ width: labels ? natural() : Number.parseFloat(style.get("width") ?? "") || natural() }),
    classList: { contains: () => false },
    style: { setProperty: (name: string, value: string) => void style.set(name, value), removeProperty: (name: string) => void style.delete(name) },
  };
  if (!labels) return { element: button as unknown as HTMLElement, style };
  const group = {
    querySelector: (selector: string) => (selector === ".nav-group-btn" ? button : null),
    classList: { contains: (name: string) => name === "nav-group" },
    getBoundingClientRect: () => ({ width: Number.parseFloat(style.get("width") ?? "") || natural() }),
    style: { setProperty: (name: string, value: string) => void style.set(name, value), removeProperty: (name: string) => void style.delete(name) },
  };
  return { element: group as unknown as HTMLElement, style };
}

/** A line of the navigation: its items, the properties the page sets on it, and a reader of what it lays out, its texts
 * by `measure`. */
function line(items: ReturnType<typeof item>[], width: number, measure = textWidth) {
  const set = new Map<string, string>();
  const list = { children: items.map(each => each.element), style: { setProperty: (name: string, value: string) => void set.set(name, value) } } as unknown as HTMLElement;
  const read: LineReader = { texts: asked => asked.map(({ texts }) => texts.map(measure)), line: () => width };
  return { list, set, read, styles: items.map(each => each.style) };
}

/** A model's line with one view shown: an entry, a group of three tables and another entry. */
const TIME = ["Time", "Model Calendar", "Time Ranges"];
function modelLine(shown: string, width: number) {
  return line([item("Overview", shown === "Overview"), item(TIME.slice(1).includes(shown) ? shown : "Time", TIME.slice(1).includes(shown), TIME), item("Versions", shown === "Versions")], width);
}

describe("The navigation's line, spread over its width", () => {
  it.each([1000, 1280, 1440])("keeps the shorter model bar on one line at %ipx with the same slots for every selected table", width => {
    const entries = [
      { id: "overview", label: "Overview" },
      ...NAV_GROUPS.slice(0, 3).flatMap(group => group.files).map(file => ({ id: file, label: file.replace(/\.csv$/, ""), file })),
      { id: "source", label: "Source Models", file: "Source Models.csv" },
      ...NAV_GROUPS[3].files.map(file => ({ id: file, label: file.replace(/\.csv$/, ""), file })),
      { id: "map", label: "Model map" },
    ];
    const items = navItems(entries.map(entry => entry.file ? { ...entry, label: tableLabel(entry) } : entry), true);
    // Every word the bar can show is written as Chrome writes it (`CHROME_WIDTHS`): a new one is to be measured there.
    const words = items.flatMap(entry => ("entries" in entry ? [entry.group.label, ...entry.entries.map(each => each.label)] : [entry.label]));
    expect(words.filter(each => !CHROME_WIDTHS.has(each))).toEqual([]);
    // Room after the page's gutters and scrollbar. The browser check measures the actual font and spacing too.
    const available = width - 64;
    const laid = entries.map(shown => {
      const bar = line(items.map(entry => {
        if (!("entries" in entry)) return item(entry.label, entry.id === shown.id, undefined, chromeWidth);
        const selected = entry.entries.find(each => each.id === shown.id);
        return item(selected?.label ?? entry.group.label, !!selected, [entry.group.label, ...entry.entries.map(each => each.label)], chromeWidth);
      }), available, chromeWidth);
      spreadLine(bar.list, bar.read);
      const widths = bar.styles.map(style => Number.parseFloat(style.get("width")!));
      expect(widths.reduce((sum, room) => sum + room, 0) + widths.length - 1).toBeLessThan(available);
      return [widths, [...bar.set]];
    });
    expect(laid).toEqual(entries.map(() => laid[0]));
  });

  it("gives each item a slot of its width at rest where the gaps are wide enough for the view shown's item to grow into them", () => {
    const rooms: ItemRoom[] = [{ rest: 80, widest: 83 }, { rest: 70, widest: 136 }, { rest: 78, widest: 81 }];
    const spread = spreadOf(rooms, 1000);
    expect(spread?.slots).toEqual([80, 70, 78]);
    // The line's width beyond the slots, less the 1px the stylesheet keeps, shared out between them: as the stylesheet works it out.
    expect(spread?.gap).toBe((1000 - 1 - 228) / 2);
    expect(spread?.gap).toBe(cssGap(spread?.slots ?? [], 1000));
  });

  it("keeps in a slot the room the gaps cannot give its item, so that, grown, it stays the least gap from the slots beside it", () => {
    const rooms: ItemRoom[] = [{ rest: 100, widest: 100 }, { rest: 100, widest: 100 }, { rest: 50, widest: 150 }, { rest: 100, widest: 100 }, { rest: 100, widest: 100 }];
    // At rest the gaps would be 41px, and the middle item would grow 50px into each.
    const spread = spreadOf(rooms, 615);
    expect(spread?.slots.map(slot => Number(slot.toFixed(6)))).toEqual([100, 100, 90, 100, 100]);
    expect(spread?.gap).toBeCloseTo(31, 6);
    expect(cssGap(spread?.slots ?? [], 615)).toBeCloseTo(31, 6);
    // Grown to its widest, the middle item takes 30px of each gap beside it, and keeps the least gap from the slots there.
    expect((150 - (spread?.slots[2] ?? 0)) / 2).toBeCloseTo((spread?.gap ?? 0) - LEAST_GAP, 6);
  });

  it("keeps in each slot the room of the widest its item can be where the line has no room at all, and the stylesheet packs the items line under line", () => {
    const rooms: ItemRoom[] = [{ rest: 100, widest: 100 }, { rest: 100, widest: 100 }, { rest: 50, widest: 150 }, { rest: 100, widest: 100 }, { rest: 100, widest: 100 }];
    expect(spreadOf(rooms, 500)).toEqual({ slots: [100, 100, 150, 100, 100], gap: LEAST_GAP });
    // Nothing to spread: one item or none, or a line with no width, as one that is hidden.
    expect([spreadOf([], 500), spreadOf([{ rest: 80, widest: 90 }], 500), spreadOf(rooms, 0)]).toEqual([undefined, undefined, undefined]);
  });

  it("takes the widest gap that holds, whatever the items: every slot between its item at rest and at its widest, and every item grown into its gaps the least gap from the next slots", () => {
    // A fixed series of lines of items, some of which grow much and most little, as a model's line.
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let round = 0; round < 400; round++) {
      const rooms = Array.from({ length: 2 + Math.floor(random() * 14) }, (): ItemRoom => {
        const rest = 40 + random() * 120;
        return { rest, widest: rest + (random() < 0.3 ? random() * 90 : random() * 6) };
      });
      const width = 200 + random() * 1600;
      const spread = spreadOf(rooms, width);
      if (!spread) throw new Error("no spread");
      const { slots, gap } = spread;
      expect(gap).toBeCloseTo(cssGap(slots, width), 6);
      expect(gap).toBeGreaterThanOrEqual(LEAST_GAP);
      rooms.forEach((room, at) => {
        expect(slots[at]).toBeGreaterThanOrEqual(room.rest - 1e-9);
        expect(slots[at]).toBeLessThanOrEqual(room.widest + 1e-9);
        // Grown to its widest from the middle of its slot, an item keeps the least gap from the slots beside it.
        expect((room.widest - slots[at]) / 2).toBeLessThanOrEqual(gap - LEAST_GAP + 1e-6);
      });
      // A slot keeps room only where its item could not grow into the gaps: the widest gap that holds is taken, so no slot
      // keeps more room than the gap leaves it short.
      rooms.forEach((room, at) => expect(slots[at] - room.rest).toBeLessThanOrEqual(Math.max(0, room.widest - room.rest - 2 * (gap - LEAST_GAP)) + 1e-6));
    }
  });

  it("sets each item the width of its slot, the same whichever view is shown, and the line its slots' widths in all and its gaps", () => {
    /** Each item's width and the shift of a group's button in its slot, and what the line is told, with a view shown. */
    const laid = (shown: string, width: number) => {
      const bar = modelLine(shown, width);
      spreadLine(bar.list, bar.read);
      return { widths: bar.styles.map(style => style.get("width")), shifts: bar.styles.map(style => style.get("--nav-shift")), line: [...bar.set] };
    };
    // A line wide enough for the group to grow into its gaps, one where its slot keeps some room, and one with no room.
    for (const width of [1000, 300, 250]) {
      const views = ["Overview", "Model Calendar", "Time Ranges", "Versions"].map(shown => laid(shown, width));
      // No view moves an item: each has the same width, and the line is told the same, whichever is shown.
      expect(views.map(view => [view.widths, view.line]), `${width}px`).toEqual(Array(4).fill([views[0].widths, views[0].line]));
      expect(views[0].line.map(([name]) => name)).toEqual(["--nav-need", "--nav-gaps"]);
    }
    // A wide line: each slot is its item at rest, unmarked, with the group's name. The group's button stands in the middle of
    // its slot, its menu under it: as wide as the slot at rest, 38.5px wider at each side with Model Calendar shown.
    const wide = laid("Model Calendar", 1000);
    expect(wide.widths).toEqual([`${30 + 8 * 7}px`, `${42 + 4 * 7}px`, `${30 + 8 * 7}px`]);
    expect([laid("Overview", 1000).shifts[1], wide.shifts[1], wide.shifts[0]]).toEqual(["0px", `${(4 * 7 - 14 * 7.5) / 2}px`, undefined]);
  });

  it("keeps what it set where the line is not laid out, and leaves a page that sets no style as it is", () => {
    const bar = modelLine("Overview", 1000);
    spreadLine(bar.list, bar.read);
    const laid = () => [[...bar.set], bar.styles.map(style => [...style])];
    const before = laid();
    // A hidden line has no width: nothing is set or taken away, and what was set stays until the line is laid out again.
    spreadLine(bar.list, { ...bar.read, line: () => 0 });
    expect([laid(), before[0].length, (before[1] as unknown[]).length]).toEqual([before, 2, 3]);
    // A page that lays nothing out and sets no style, as the stand-in page of the tests, is left as it is.
    expect(() => spreadLine({ children: [], style: {} } as unknown as HTMLElement)).not.toThrow();
  });
});
