/** The navigation's line spreads its items evenly over its whole width where they all fit on one line, and packs them at
 * its start, line under line, where they do not (results.css `.nav-list`, its column-gap). The stylesheet cannot add up
 * the items' widths, so the page tells it two numbers: the items' widths in all (`--nav-need`) and how many gaps they
 * leave (`--nav-gaps`). Each item keeps the room of every text it can show, so its width is the same whichever view is
 * shown: the two numbers, and where each item stands, depend only on the line's width, and nothing moves as the view
 * changes. The line is measured only where it is laid out: when it is drawn, and when it changes size, as it does when
 * it comes into sight (main.ts). */

/** What the line's stylesheet is told of its items: their widths in all and the gaps between them. Nothing where no item
 * has a width, as where the line is hidden, or where there is one item or none, which has nothing to spread. */
export function spreadOf(widths: readonly number[]): { need: number; gaps: number } | undefined {
  const need = widths.reduce((sum, width) => sum + width, 0);
  return need > 0 && widths.length > 1 ? { need, gaps: widths.length - 1 } : undefined;
}

/** Tells the line's stylesheet how wide its items are in all and how many gaps they leave. A line that is not laid out
 * keeps what it was told before: it is told again when it changes size. */
export function spreadLine(list: HTMLElement): void {
  const spread = spreadOf(Array.from(list.children, item => item.getBoundingClientRect().width));
  if (!spread || typeof list.style.setProperty !== "function") return;
  list.style.setProperty("--nav-need", `${spread.need}px`);
  list.style.setProperty("--nav-gaps", String(spread.gaps));
}
