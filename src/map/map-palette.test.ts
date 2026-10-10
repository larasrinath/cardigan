import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COLOUR_TOKENS, contrast, FALLBACK, layerClass, layerColour, layerStriped, over, parseColor, readPalette, SECTION_COLOURS, SECTION_MARKS, sectionToken, type MapPalette, type Rgb } from "./map-palette.js";

const read = (name: string): string => readFileSync(new URL(`../../${name}`, import.meta.url), "utf8");
const MAP_CSS = read("map.css");
const PAGE_CSS = read("results.css");

/** The tokens a rule of a stylesheet sets, by the rule's selector as it is written. */
function tokensOf(css: string, selector: string): Map<string, string> {
  const tokens = new Map<string, string>();
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, selectors, body] of plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectors.split(",").some(each => each.trim() === selector)) continue;
    for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) tokens.set(name, value.trim());
  }
  return tokens;
}

/** The tokens in force on the map's element in a theme: the page's, then the map's own, a later rule over an earlier. */
function themeTokens(theme: "light" | "dark"): (name: string) => string {
  const tokens = new Map([...tokensOf(PAGE_CSS, ":root"), ...tokensOf(MAP_CSS, ".map-root")]);
  if (theme === "dark") for (const [name, value] of [...tokensOf(PAGE_CSS, ':root[data-theme="dark"]'), ...tokensOf(MAP_CSS, ':root[data-theme="dark"] .map-root')]) tokens.set(name, value);
  const resolve = (value: string, depth = 0): string => (depth > 8 ? value : value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => resolve(tokens.get(name) ?? "", depth + 1)));
  return name => resolve(tokens.get(name) ?? "");
}

const solid = (value: string): string | undefined => (parseColor(value) ? value : undefined);
const paletteOf = (theme: "light" | "dark"): MapPalette => readPalette(themeTokens(theme), solid);
const rgb = (value: string): Rgb => {
  const colour = parseColor(value);
  if (!colour) throw new Error(`${value} is no colour`);
  return colour;
};
/** The contrast of a colour on a surface; a colour that lets the surface through is first laid over it. */
const on = (colour: string, surface: string): number => contrast(over(rgb(colour), rgb(surface)), rgb(surface));

describe("A colour as the map reads it", () => {
  it("reads hex numbers of three, four, six and eight digits", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("#2a78d6")).toEqual({ r: 42, g: 120, b: 214, a: 1 });
    expect(parseColor(" #2A78D6 ")).toEqual({ r: 42, g: 120, b: 214, a: 1 });
    expect(parseColor("#0008")?.a).toBeCloseTo(0.533, 2);
    expect(parseColor("#19191980")?.a).toBeCloseTo(0.502, 2);
  });

  it("reads rgb and rgba with commas or spaces, and the form a canvas answers in", () => {
    expect(parseColor("rgb(25, 25, 25)")).toEqual({ r: 25, g: 25, b: 25, a: 1 });
    expect(parseColor("rgba(25,25,25,.1)")).toEqual({ r: 25, g: 25, b: 25, a: 0.1 });
    expect(parseColor("rgba(250, 249, 245, 0.08)")).toEqual({ r: 250, g: 249, b: 245, a: 0.08 });
    expect(parseColor("rgb(25 25 25 / 50%)")).toEqual({ r: 25, g: 25, b: 25, a: 0.5 });
    const mixed = parseColor("color(srgb 0.5 0.25 1 / 0.4)");
    expect([mixed?.r, mixed?.g, mixed?.b, mixed?.a]).toEqual([127.5, 63.75, 255, 0.4]);
  });

  it("takes nothing else for a colour", () => {
    for (const text of ["", "red", "#12", "#12345", "#ggg", "rgb(1, 2)", "var(--text)", "color(display-p3 1 0 0)", "url(x)", "javascript:alert(1)"]) expect(parseColor(text), text).toBeUndefined();
  });

  it("counts contrast as the guidelines do", () => {
    expect(contrast(rgb("#000"), rgb("#fff"))).toBeCloseTo(21, 5);
    expect(contrast(rgb("#fff"), rgb("#000"))).toBeCloseTo(21, 5);
    expect(contrast(rgb("#777"), rgb("#777"))).toBe(1);
    expect(contrast(rgb("#767676"), rgb("#fff"))).toBeCloseTo(4.54, 2);
  });

  it("lays a colour that lets through over what is under it", () => {
    expect(over(rgb("rgba(0, 0, 0, 0.5)"), rgb("#ffffff"))).toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 });
    expect(over(rgb("#2a78d6"), rgb("#ffffff"))).toEqual({ r: 42, g: 120, b: 214, a: 1 });
  });
});

describe("The palette the canvas draws with", () => {
  it("reads each colour from its token, and the fonts from the page's", () => {
    const tokens: Record<string, string> = { "--map-canvas-bg": " #101010 ", "--text": "#eeeeee", "--map-section-3": "#00ff00", "--sans": " Inter, sans-serif ", "--mono": "Menlo, monospace" };
    const palette = readPalette(name => tokens[name] ?? "", solid);
    expect([palette.canvas, palette.select, palette.sections[2], palette.sans, palette.mono]).toEqual(["#101010", "#eeeeee", "#00ff00", "Inter, sans-serif", "Menlo, monospace"]);
  });

  it("draws in the light theme's colours where a token is missing or is no colour", () => {
    const palette = readPalette(name => (name === "--map-node-fill" ? "not a colour" : name === "--map-edge" ? "var(--nowhere)" : ""), solid);
    expect(palette).toEqual(FALLBACK);
  });

  it("uses a colour as the canvas gives it back", () => {
    const palette = readPalette(name => (name === "--map-grid" ? "rgba(25,25,25,.1)" : ""), value => (value.startsWith("rgba") ? "rgba(25, 25, 25, 0.1)" : undefined));
    expect(palette.grid).toBe("rgba(25, 25, 25, 0.1)");
  });

  it("gives a section its colour by its place, the first again after the eighth", () => {
    expect(SECTION_COLOURS).toBe(8);
    expect([sectionToken(0), sectionToken(7), sectionToken(8), sectionToken(17)]).toEqual(["--map-section-1", "--map-section-8", "--map-section-1", "--map-section-2"]);
    expect([layerColour(FALLBACK, "s0"), layerColour(FALLBACK, "s7"), layerColour(FALLBACK, "s8"), layerColour(FALLBACK, "s9")]).toEqual([FALLBACK.sections[0], FALLBACK.sections[7], FALLBACK.sections[0], FALLBACK.sections[1]]);
    // The ninth to the sixteenth take the eight colours again in stripes, and the seventeenth starts again at the first.
    expect([layerClass("s0"), layerClass("s7"), layerClass("s8"), layerClass("s15"), layerClass("s16"), layerClass("s23")])
      .toEqual(["map-c-s1", "map-c-s8", "map-c-s1 map-c-striped", "map-c-s8 map-c-striped", "map-c-s1", "map-c-s8"]);
    expect([SECTION_MARKS, ...["s0", "s7", "s8", "s15", "s16", "s24", "lineitem", "s8x"].map(layerStriped)]).toEqual([16, false, false, true, true, false, true, false, false]);
  });

  it("gives what is in a module's graph the colour of what it is", () => {
    expect([layerColour(FALLBACK, "lineitem"), layerColour(FALLBACK, "heading"), layerColour(FALLBACK, "external"), layerColour(FALLBACK, "list"), layerColour(FALLBACK, "property")])
      .toEqual([FALLBACK.lineItem, FALLBACK.heading, FALLBACK.external, FALLBACK.list, FALLBACK.property]);
    expect(["lineitem", "heading", "external", "list", "property"].map(layerClass)).toEqual(["map-c-lineitem", "map-c-heading", "map-c-external", "map-c-list", "map-c-property"]);
    // A layer it does not know is drawn as what is outside the graph. A layer's name never becomes a class as it is.
    expect([layerColour(FALLBACK, "x\" onclick=\""), layerClass("x\" onclick=\""), layerClass("constructor")]).toEqual([FALLBACK.external, "map-c-external", "map-c-external"]);
  });
});

describe("The map's colours in the stylesheet", () => {
  const themes = ["light", "dark"] as const;

  it("sets every token the canvas reads, in both themes, as a colour", () => {
    for (const theme of themes) {
      const token = themeTokens(theme);
      for (const name of [...Object.values(COLOUR_TOKENS), ...Array.from({ length: SECTION_COLOURS }, (_, place) => sectionToken(place))]) expect(parseColor(token(name)), `${theme} ${name}: ${token(name)}`).toBeDefined();
      expect(token("--sans")).not.toBe("");
      expect(token("--mono")).not.toBe("");
    }
  });

  it("gives the dark theme its own steps of the section colours and of what is in a module's graph", () => {
    const [light, dark] = [paletteOf("light"), paletteOf("dark")];
    expect(dark.sections.filter((colour, place) => colour !== light.sections[place]).length).toBeGreaterThanOrEqual(7);
    expect([dark.canvas, dark.nodeFill, dark.nodeText, dark.lineItem, dark.traceUp, dark.traceDown]).not.toEqual([light.canvas, light.nodeFill, light.nodeText, light.lineItem, light.traceUp, light.traceDown]);
    expect(new Set(light.sections).size).toBe(SECTION_COLOURS);
    expect(new Set(dark.sections).size).toBe(SECTION_COLOURS);
  });

  it("keeps what stands in for a missing token the same as the light theme", () => {
    expect({ ...paletteOf("light"), sans: FALLBACK.sans, mono: FALLBACK.mono, grid: FALLBACK.grid }).toEqual(FALLBACK);
    expect(parseColor(paletteOf("light").grid)).toEqual(parseColor(FALLBACK.grid));
  });

  it("gives text on a node the contrast the guidelines ask of text (AA, 4.5 to 1), selected or not, in both themes", () => {
    for (const theme of themes) {
      const palette = paletteOf(theme);
      for (const fill of [palette.nodeFill, palette.nodeFillSelected]) {
        expect(on(palette.nodeText, fill), `${theme}: a node's name on ${fill}`).toBeGreaterThanOrEqual(4.5);
        expect(on(palette.nodeTextMuted, fill), `${theme}: a node's small lines on ${fill}`).toBeGreaterThanOrEqual(4.5);
      }
      // A node is not see-through: what is under it does not change its text's contrast.
      expect(parseColor(palette.nodeFill)?.a).toBe(1);
      expect(parseColor(palette.nodeFillSelected)?.a).toBe(1);
    }
  });

  it("gives the panels' text the same contrast on the panels, in both themes", () => {
    for (const theme of themes) {
      const token = themeTokens(theme);
      for (const surface of ["--panel", "--panel-2"]) {
        for (const text of ["--text", "--text-2"]) expect(on(token(text), token(surface)), `${theme}: ${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
      for (const text of ["--text-3", "--accent"]) expect(on(token(text), token("--panel")), `${theme}: ${text} on --panel`).toBeGreaterThanOrEqual(4.5);
      expect(on(token("--accent-ink"), token("--accent-soft")), `${theme}: the main button`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("makes the marks that are not text stand out: a trace on the canvas and on a node, a node selected, a match", () => {
    for (const theme of themes) {
      const palette = paletteOf(theme);
      for (const mark of [palette.traceUp, palette.traceDown, palette.select, palette.match]) {
        expect(on(mark, palette.canvas), `${theme}: ${mark} on the canvas`).toBeGreaterThanOrEqual(3);
        expect(on(mark, palette.nodeFill), `${theme}: ${mark} on a node`).toBeGreaterThanOrEqual(3);
      }
      // What is outside the graph is told by its dashed edge, which has to be seen on the canvas.
      expect(on(palette.external, palette.canvas), `${theme}: the dashed edge`).toBeGreaterThanOrEqual(3);
      // Upstream and downstream are two colours apart.
      expect(contrast(rgb(palette.traceUp), rgb(palette.traceDown))).toBeLessThan(21);
      expect(palette.traceUp).not.toBe(palette.traceDown);
    }
  });

  it("draws a link in a colour that stands out from the canvas (3 to 1), in both themes, and lets nothing through it", () => {
    for (const theme of themes) {
      const palette = paletteOf(theme);
      expect(on(palette.edge, palette.canvas), `${theme}: a link on the canvas`).toBeGreaterThanOrEqual(3);
      expect(parseColor(palette.edge)?.a, theme).toBe(1);
    }
    expect(on(FALLBACK.edge, FALLBACK.canvas)).toBeGreaterThanOrEqual(3);
  });

  it("makes every layer's colour seen on a node and on a panel, where a name always stands beside it", () => {
    for (const theme of themes) {
      const palette = paletteOf(theme);
      const panel = themeTokens(theme)("--panel");
      for (const colour of [...palette.sections, palette.lineItem, palette.list, palette.property]) {
        expect(on(colour, palette.nodeFill), `${theme}: ${colour} on a node`).toBeGreaterThanOrEqual(2);
        expect(on(colour, panel), `${theme}: ${colour} on a panel`).toBeGreaterThanOrEqual(2);
      }
      // In the dark theme every one of them reaches 3 to 1; in the light theme three hues are lighter than that, and the
      // names beside them carry what they say.
      if (theme === "dark") for (const colour of [...palette.sections, palette.lineItem, palette.list, palette.property]) expect(on(colour, palette.nodeFill), colour).toBeGreaterThanOrEqual(3);
    }
  });
});
