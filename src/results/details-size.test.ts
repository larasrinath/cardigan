import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DETAILS_WIDTH_KEY, resizeDetails } from "./details-size.js";
import { FakePage } from "./dom.test-support.js";

describe("The floating details width", () => {
  let page: FakePage;
  let stored: Map<string, string>;
  let resized: () => void;
  beforeEach(() => {
    page = new FakePage('<html><body><aside id="drawer"><div id="edge" tabindex="0"></div><button id="drawerClose">Close</button></aside></body></html>');
    stored = new Map();
    vi.stubGlobal("document", page.document);
    vi.stubGlobal("window", { innerWidth: 1400, addEventListener: (_name: string, listener: () => void) => { resized = listener; } });
    vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
  });
  afterEach(() => vi.unstubAllGlobals());
  const mount = () => resizeDetails(page.id("drawer") as unknown as HTMLElement, page.id("edge") as unknown as HTMLElement);
  const shown = () => page.id("drawer").style["--details-width"];
  const pointer = (type: string, x: number, id = 1) => page.id("edge").dispatch(type, { button: 0, pointerId: id, clientX: x });

  it("drags from the left edge, clamps both limits, captures the pointer, and keeps the chosen width on remount", () => {
    mount();
    const edge = page.id("edge");
    expect(shown()).toBe("620px");
    expect(pointer("pointerdown", 780).defaultPrevented).toBe(true);
    expect([edge.hasPointerCapture(1), page.document.activeElement === edge, edge.focusedIntoSight]).toEqual([true, true, 0]);
    pointer("pointermove", 580, 2);
    expect(shown()).toBe("620px");
    pointer("pointermove", 580);
    expect(shown()).toBe("820px");
    pointer("pointermove", -200);
    expect(shown()).toBe("980px");
    pointer("pointermove", 1600);
    expect(shown()).toBe("360px");
    pointer("pointermove", 600);
    pointer("pointerup", 600);
    expect([edge.hasPointerCapture(1), stored.get(DETAILS_WIDTH_KEY)]).toEqual([false, "800"]);
    pointer("pointermove", 500);
    mount();
    expect(shown()).toBe("800px");
  });

  it("resizes by keyboard with readable limits, keeping focus and preventing arrow scrolling", () => {
    mount();
    const edge = page.id("edge");
    edge.focus({ preventScroll: true });
    expect(page.key("ArrowLeft").defaultPrevented).toBe(true);
    expect(shown()).toBe("630px");
    edge.dispatch("keydown", { key: "ArrowRight", shiftKey: true });
    expect(shown()).toBe("580px");
    page.key("Home");
    page.key("ArrowRight");
    expect(shown()).toBe("360px");
    page.key("End");
    page.key("ArrowLeft");
    expect([edge.getAttribute("aria-valuemin"), edge.getAttribute("aria-valuemax"), edge.getAttribute("aria-valuenow"), edge.getAttribute("aria-valuetext")])
      .toEqual(["360", "980", "980", "980 pixels"]);
    expect(page.document.activeElement).toBe(edge);
    expect(page.key("Tab").defaultPrevented).toBe(false);
  });

  it("temporarily clamps a saved width, hides the edge below 900px, and restores the preference when widened", () => {
    stored.set(DETAILS_WIDTH_KEY, "950");
    mount();
    window.innerWidth = 1000;
    resized();
    expect(shown()).toBe("700px");
    pointer("pointerdown", 300);
    window.innerWidth = 899;
    resized();
    expect([page.id("edge").hidden, page.id("edge").hasPointerCapture(1), page.document.activeElement.id]).toEqual([true, false, "drawerClose"]);
    pointer("pointermove", 0);
    expect(stored.get(DETAILS_WIDTH_KEY)).toBe("950");
    window.innerWidth = 1400;
    resized();
    expect([shown(), page.id("edge").hidden]).toEqual(["950px", false]);
  });

  it.each(["pointercancel", "lostpointercapture", "close"])("ends a drag on %s", reason => {
    const control = mount();
    pointer("pointerdown", 780);
    pointer("pointermove", 700);
    if (reason === "close") control.stop(); else pointer(reason, 700);
    pointer("pointermove", 400);
    expect([shown(), page.id("drawer").classList.contains("resizing")]).toEqual(["700px", false]);
  });

  it.each(["", "nonsense", "NaN", "Infinity", "-20", "300"])("ignores an invalid saved width (%s)", value => {
    stored.set(DETAILS_WIDTH_KEY, value);
    mount();
    expect(shown()).toBe("620px");
  });

  it("still opens and resizes when storage throws on reads and writes", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw Error("Unavailable"); }, setItem: () => { throw Error("Full"); } });
    mount();
    page.id("edge").focus();
    page.key("ArrowLeft");
    expect(shown()).toBe("630px");
  });
});
