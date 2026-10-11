/** The navigation's line spreads its items evenly over its whole width where they all fit on one line, and packs them at
 * its start, line under line, where they do not (results.css `.nav-list`, its column-gap). The stylesheet cannot add up
 * the items' widths, so the page tells it two numbers: the items' widths in all (`--nav-need`) and how many gaps they
 * leave (`--nav-gaps`).
 *
 * Each item stands in a slot of its own, which no view changes, so that nothing moves as the view changes: as wide as the
 * item at rest, unmarked, with its own words (an entry) or its name (a group), so that the gaps between the items are
 * equal. The item of the view shown has its words in bold, and a group's button names the table shown in it, which may be
 * longer than its name: that item shows in the middle of its slot and past its two ends, into the gaps beside it, and no
 * other item moves. Where the gaps are too narrow for an item to grow into them and keep the least gap from the items
 * beside it, its slot keeps the room it lacks, at rest as well. So the slots depend on the line's width and the items'
 * words alone, never on the view shown. The line is measured only where it is laid out: when it is drawn, and when it
 * changes size, as it does when it comes into sight (main.ts). */

/** The least gap between two items, the stylesheet's (results.css `.nav-list`): where the line has no more room, its
 * items stand this far apart. An item that grows into a gap keeps this far from the item beyond it. */
export const LEAST_GAP = 1;
/** What the stylesheet keeps back of the line's width, so that rounding never takes the last item to a next line. */
const KEPT = 1;
/** The weight of the words of the item of the view shown, the mark's bold (results.css), and of the other items' words. */
export const MARKED_WEIGHT = "600";
export const PLAIN_WEIGHT = "400";

/** An item's room on the line: its width at rest, and the widest it is as the view shown's item. */
export interface ItemRoom { rest: number; widest: number }

/** Where the line's items stand: each item's slot, the width the line keeps for it whichever view is shown, and the gap the
 * stylesheet leaves between two slots. */
export interface Spread { slots: number[]; gap: number }

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

/** The slots of the line's items, for a line `line` wide, and the gap between them. Each slot is its item's width at rest,
 * and keeps more room only where the gaps are too narrow for the item to grow into them as the view shown's: so much
 * more that the item, grown from the middle of its slot, stays `LEAST_GAP` from the slots beside it. The widest gap that
 * holds is taken: the slots it leaves, and the line's width beyond them shared out as the gaps (as the stylesheet does),
 * give at least that gap. Where the items do not fit on one line even so, each slot keeps the room of the widest the item
 * can be, and the stylesheet packs them line under line, `LEAST_GAP` apart. Nothing where there is one item or none,
 * which has nothing to spread, or where the line has no width. */
export function spreadOf(rooms: readonly ItemRoom[], line: number): Spread | undefined {
  if (rooms.length < 2 || !(line > 0)) return undefined;
  const gaps = rooms.length - 1;
  const grows = rooms.map(room => Math.max(0, room.widest - room.rest));
  const slotsAt = (gap: number): number[] => rooms.map((room, at) => room.rest + Math.max(0, grows[at] - 2 * (gap - LEAST_GAP)));
  /** The gap the stylesheet leaves between slots: the line's width beyond them shared out, and never less than the least. */
  const gapOf = (slots: readonly number[]): number => Math.max(LEAST_GAP, (line - KEPT - sum(slots)) / gaps);
  /** How much wider the gap is that the slots for `gap` leave than `gap` itself: not below 0 where `gap` holds. */
  const spare = (gap: number): number => gapOf(slotsAt(gap)) - gap;
  // The gaps under which an item's slot starts to keep room, the widest first, down to the least gap. Above the widest,
  // every slot is its item's width at rest; between two of them, the more the gap narrows, the more room the slots keep.
  const bends = [...new Set([LEAST_GAP, ...grows.map(grow => LEAST_GAP + grow / 2)])].sort((a, b) => b - a);
  let gap = gapOf(slotsAt(bends[0]));
  if (gap < bends[0]) {
    // Between two bends, what the gap spares falls as the gap widens past where it holds, and no further: the widest gap
    // that holds is where it crosses 0, found by halving. At the least gap every slot is the widest its item can be,
    // which always holds.
    gap = LEAST_GAP;
    for (let at = 1; at < bends.length; at++) {
      let [holds, fails] = [bends[at], bends[at - 1]];
      if (spare(holds) < 0) continue;
      for (let step = 0; step < 60; step++) {
        const middle = (holds + fails) / 2;
        if (spare(middle) >= 0) holds = middle;
        else fails = middle;
      }
      gap = holds;
      break;
    }
  }
  const slots = slotsAt(gap);
  return { slots, gap: gapOf(slots) };
}

/** A text as an item of the line writes it, at a weight. */
export type WeightedText = readonly [text: string, weight: string];

/** What the page reads of the line as the browser lays it out: the widths of texts written as each item writes its words,
 * and the width the line has for its items, within its padding. The tests give their own. */
export interface LineReader {
  texts(asked: readonly { item: HTMLElement; texts: readonly WeightedText[] }[]): number[][];
  line(list: HTMLElement): number;
}

/** The browser's reader. Each item writes the texts it is asked in a box of its own, out of the flow and unseen, which
 * takes its font from the item's button; all are written before any is read, so the page is laid out once, and the boxes
 * are taken away again before anything is drawn. */
const BROWSER: LineReader = {
  texts(asked) {
    const boxes = asked.map(({ item, texts }) => {
      const box = item.ownerDocument.createElement("span");
      box.className = "nav-measure";
      box.setAttribute("aria-hidden", "true");
      for (const [text, weight] of texts) {
        const words = item.ownerDocument.createElement("span");
        words.textContent = text;
        words.style.fontWeight = weight;
        box.append(words);
      }
      (item.querySelector(".nav-group-btn") ?? item).append(box);
      return box;
    });
    const widths = boxes.map(box => Array.from(box.children, words => words.getBoundingClientRect().width));
    for (const box of boxes) box.remove();
    return widths;
  },
  line(list) {
    const style = getComputedStyle(list);
    return list.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  },
};

/** What an item of the line can show: its words at rest, unmarked (an entry's own, a group's name), and those it shows in
 * bold as the view shown's item (an entry's own, the label of each table of a group's menu: markup.ts `navHtml`); what it
 * shows now, and whether in bold. */
function wordsOf(item: HTMLElement): { rest: string; marked: string[]; now: WeightedText } | undefined {
  const button = item.classList.contains("nav-group") ? item.querySelector<HTMLElement>(".nav-group-btn") : item;
  const words = button?.querySelector("span");
  if (!button || !words) return undefined;
  const now: WeightedText = [words.textContent ?? "", button.hasAttribute("aria-current") ? MARKED_WEIGHT : PLAIN_WEIGHT];
  const labels = button.dataset.labels?.split("\n");
  return labels && labels.length > 1 ? { rest: labels[0], marked: labels.slice(1), now } : { rest: now[0], marked: [now[0]], now };
}

/** Lays the line's items in their slots: gives each item its slot's width, in the middle of which it shows what it shows
 * (results.css), and tells the line's stylesheet how wide the slots are in all and how many gaps they leave. The slots,
 * and so where each item stands, are worked out from what the items can show alone, and only the slots take room on the
 * line: whatever an item shows, the same width is set for it, so no view moves another item by as much as a rounding.
 * A group's menu is told how far its button stands from its slot's start (`--nav-shift`), to open under the button. An
 * item's own width beside its words, its icon, chevron and padding, is the same whatever it shows, so its room at rest
 * and at its widest is that and the width of the words. A line that is not laid out keeps what it was told before: it is
 * told again when it changes size. */
export function spreadLine(list: HTMLElement, read: LineReader = BROWSER): void {
  if (typeof list.style.setProperty !== "function") return;
  const line = read.line(list);
  const items = Array.from(list.children) as HTMLElement[];
  const words = items.map(wordsOf);
  if (!(line > 0) || items.length < 2 || words.some(each => !each)) return;
  const known = words as NonNullable<(typeof words)[number]>[];
  // Each item at its own width, as it shows what it shows now, to be measured.
  for (const item of items) item.style.removeProperty("width");
  const buttons = items.map(item => item.querySelector<HTMLElement>(".nav-group-btn") ?? item);
  const widths = buttons.map(button => button.getBoundingClientRect().width);
  if (widths.some(width => !(width > 0))) return;
  const measured = read.texts(items.map((item, at) => ({
    item, texts: [known[at].now, [known[at].rest, PLAIN_WEIGHT], ...known[at].marked.map((label): WeightedText => [label, MARKED_WEIGHT])],
  })));
  const rooms = measured.map(([now, rest, ...marked], at): ItemRoom => {
    const own = widths[at] - now;
    return { rest: own + rest, widest: own + Math.max(rest, ...marked) };
  });
  const spread = spreadOf(rooms, line);
  if (!spread) return;
  // To the thousandth of a pixel, finer than the browser lays out at any zoom: a slot worked out from what another view
  // shows may differ from it in the last digits of its sum, and is still set the same width.
  const slots = spread.slots.map(slot => Math.round(slot * 1000) / 1000);
  items.forEach((item, at) => {
    item.style.setProperty("width", `${slots[at]}px`);
    if (buttons[at] !== item) item.style.setProperty("--nav-shift", `${(slots[at] - widths[at]) / 2}px`);
  });
  list.style.setProperty("--nav-need", `${sum(slots)}px`);
  list.style.setProperty("--nav-gaps", String(items.length - 1));
}
