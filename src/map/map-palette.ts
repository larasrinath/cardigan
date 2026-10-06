/** The map's colours. The page's stylesheets say them (map.css, on top of results.css): the canvas cannot use a style
 * rule, so the view reads each colour's token from the computed styles and draws with the values. This module names the
 * tokens, says which colour a node takes, and holds the arithmetic that checks a colour against another. It reads no
 * page: the view hands it a function that reads a token. */

export interface Rgb { r: number; g: number; b: number; a: number }

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTION = /^(rgba?|color)\(\s*(.+?)\s*\)$/i;

const channel = (text: string, scale: number): number => (text.endsWith("%") ? parseFloat(text) / 100 * scale : parseFloat(text));

/** A colour as its red, green and blue from 0 to 255 and its opacity from 0 to 1, where it is written as a hex number,
 * as rgb() or rgba(), or as color(srgb ...): the forms a stylesheet's token and a canvas's own answer take. */
export function parseColor(text: string): Rgb | undefined {
  const value = text.trim();
  const hex = HEX.exec(value)?.[1];
  if (hex) {
    const digits = hex.length <= 4 ? [...hex].map(digit => digit + digit) : hex.match(/../g)!;
    const [r, g, b, a = 255] = digits.map(pair => parseInt(pair, 16));
    return { r, g, b, a: a / 255 };
  }
  const call = FUNCTION.exec(value);
  if (!call) return undefined;
  const [colours, opacity] = call[2].split("/").map(part => part.trim());
  const parts = colours.split(/[\s,]+/).filter(part => part !== "");
  const srgb = call[1].toLowerCase() === "color";
  if (srgb && parts.shift()?.toLowerCase() !== "srgb") return undefined;
  if (parts.length < 3 || parts.length > 4) return undefined;
  const [r, g, b] = parts.slice(0, 3).map(part => (srgb ? channel(part, 1) * 255 : channel(part, 255)));
  const a = opacity !== undefined ? channel(opacity, 1) : parts.length === 4 ? channel(parts[3], 1) : 1;
  return [r, g, b, a].every(Number.isFinite) ? { r, g, b, a } : undefined;
}

/** A colour that lets the one under it through, as the solid colour the two make. */
export function over(top: Rgb, under: Rgb): Rgb {
  const mix = (above: number, below: number): number => above * top.a + below * (1 - top.a);
  return { r: mix(top.r, under.r), g: mix(top.g, under.g), b: mix(top.b, under.b), a: 1 };
}

function luminance(colour: Rgb): number {
  const linear = (value: number): number => {
    const share = value / 255;
    return share <= 0.03928 ? share / 12.92 : Math.pow((share + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linear(colour.r) + 0.7152 * linear(colour.g) + 0.0722 * linear(colour.b);
}

/** The contrast of two solid colours as the accessibility guidelines count it: from 1 (the same) to 21 (black on white). */
export function contrast(one: Rgb, other: Rgb): number {
  const [light, dark] = [luminance(one), luminance(other)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

/** What the canvas draws with. Each is a colour as a stylesheet writes it; the fonts are lists of font families. */
export interface MapPalette {
  canvas: string;
  grid: string;
  nodeFill: string;
  nodeFillSelected: string;
  nodeBorder: string;
  nodeText: string;
  nodeTextMuted: string;
  edge: string;
  /** The node selected: its border and the ring around it. */
  select: string;
  /** The ring around a node the search names. */
  match: string;
  traceUp: string;
  traceDown: string;
  /** A section's colour, by the section's place: after the last the first comes again. */
  sections: string[];
  lineItem: string;
  heading: string;
  external: string;
  list: string;
  property: string;
  sans: string;
  mono: string;
}

type Colour = Exclude<keyof MapPalette, "sections" | "sans" | "mono">;

/** The token each colour is read from. Those without "map" in their name are the results page's own. */
export const COLOUR_TOKENS: Record<Colour, string> = {
  canvas: "--map-canvas-bg", grid: "--map-grid",
  nodeFill: "--map-node-fill", nodeFillSelected: "--map-node-fill-selected", nodeBorder: "--map-node-border", nodeText: "--map-node-text", nodeTextMuted: "--map-node-text-2",
  edge: "--map-edge", select: "--text", match: "--accent", traceUp: "--map-trace-up", traceDown: "--map-trace-down",
  lineItem: "--map-line-item", heading: "--map-heading", external: "--map-external", list: "--map-list", property: "--map-property",
};
export const SECTION_COLOURS = 8;
export const sectionToken = (place: number): string => `--map-section-${(place % SECTION_COLOURS) + 1}`;

/** What stands in for a token the styles do not give, or give as no colour: the light theme, so that a map without its
 * stylesheet is still drawn. */
export const FALLBACK: MapPalette = {
  canvas: "#f6f4ee", grid: "rgba(25, 25, 25, 0.1)",
  nodeFill: "#ffffff", nodeFillSelected: "#f3f1ea", nodeBorder: "#d4d2c8", nodeText: "#191919", nodeTextMuted: "#5b584f",
  edge: "#8b8880", select: "#191919", match: "#2b5bd7", traceUp: "#2a78d6", traceDown: "#e34948",
  sections: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  lineItem: "#4a3aa7", heading: "#b3b0a5", external: "#898781", list: "#1baf7a", property: "#eb6834",
  sans: "sans-serif", mono: "monospace",
};

/** The palette of the styles in force. `read` gives a token's value, "" for none; `colour` gives a value back as a
 * colour the canvas takes, or nothing when it is none. */
export function readPalette(read: (token: string) => string, colour: (value: string) => string | undefined): MapPalette {
  const pick = (token: string, fallback: string): string => {
    const value = read(token).trim();
    return (value !== "" && colour(value)) || fallback;
  };
  const colours = Object.fromEntries((Object.keys(COLOUR_TOKENS) as Colour[]).map(name => [name, pick(COLOUR_TOKENS[name], FALLBACK[name])])) as Record<Colour, string>;
  return {
    ...colours,
    sections: FALLBACK.sections.map((fallback, place) => pick(sectionToken(place), fallback)),
    sans: read("--sans").trim() || FALLBACK.sans,
    mono: read("--mono").trim() || FALLBACK.mono,
  };
}

/** The colour of each layer that is no section's. A layer is looked up as a key of this map and of nothing else. */
const LAYER_COLOURS: ReadonlyMap<string, Colour> = new Map<string, Colour>([["lineitem", "lineItem"], ["heading", "heading"], ["external", "external"], ["list", "list"], ["property", "property"]]);
const SECTION_LAYER = /^s(\d+)$/;

/** The colour of a layer (map-graphs.ts): a section's by its place, or the colour of what the node is. A layer the map
 * does not know has the colour of what is outside the graph. */
export function layerColour(palette: MapPalette, layer: string): string {
  const section = SECTION_LAYER.exec(layer);
  if (section) return palette.sections[Number(section[1]) % palette.sections.length];
  return palette[LAYER_COLOURS.get(layer) ?? "external"];
}

/** The class that gives an element a layer's colour as its background (map.css): for a dot beside a name. It is one
 * of a fixed set, whatever the layer is called. */
export function layerClass(layer: string): string {
  const section = SECTION_LAYER.exec(layer);
  if (section) return `map-c-s${(Number(section[1]) % SECTION_COLOURS) + 1}`;
  return `map-c-${LAYER_COLOURS.has(layer) ? layer : "external"}`;
}
