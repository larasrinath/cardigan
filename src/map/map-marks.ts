/** One key outline for the canvas and the legend's SVG, in a 14 by 8 view box. The bow's hole uses even-odd fill. */
export const KEY_SHAPES: readonly (readonly (readonly [number, number])[])[] = [
  [[0, 2], [2, 0], [5, 0], [7, 2], [7, 3], [14, 3], [14, 5], [12, 5], [12, 7], [10, 7], [10, 5], [7, 5], [7, 6], [5, 8], [2, 8], [0, 6]],
  [[2, 2], [5, 2], [5, 6], [2, 6]],
];
export const KEY_PATH = KEY_SHAPES.map(points => points.map(([x, y], index) => `${index ? "L" : "M"}${x} ${y}`).join("") + "Z").join("");

/** The drawing of Find source inputs, in a 16 by 16 view box to be stroked as the menu bar's icons are (1.5, round ends
 * and joins): three lines that come together, and the one value they make. The map's details (map-markup.ts) and a row's
 * details on the results page (results/markup.ts `OPEN_ICONS`) both draw it from here. */
export const SOURCES_PATH = '<path d="M2 3.5h2.5L8 8M2 8h6M2 12.5h2.5L8 8"/><circle cx="11.5" cy="8" r="2.5"/>';
