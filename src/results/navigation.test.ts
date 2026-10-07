import { describe, expect, it } from "vitest";
import { NARROW_WINDOW, NAVIGATION_KEY, navigationWords, storedNavigation } from "./navigation.js";

describe("What is remembered and said about the navigation", () => {
  it("reads the choice from the browser's store under its one name: put away only where the store says so", () => {
    const asked: string[] = [];
    const store = (held: string | null) => (key: string) => { asked.push(key); return held; };
    expect([storedNavigation(store("hidden")), storedNavigation(store("shown")), storedNavigation(store(null))]).toEqual(["hidden", "shown", "shown"]);
    // Something else under the name is no choice: the navigation is shown, as on a browser that has kept nothing.
    for (const other of ["", "Hidden", "hidden ", "true", "collapsed", "0"]) expect([other, storedNavigation(store(other))]).toEqual([other, "shown"]);
    // It asks for that one name, and for nothing else.
    expect([...new Set(asked)]).toEqual([NAVIGATION_KEY]);
    expect(NAVIGATION_KEY).toBe("cardigan-navigation");
  });

  it("shows the navigation where the browser refuses its store, or has none", () => {
    const refused = (): string | null => { throw Object.assign(new Error("The operation is insecure."), { name: "SecurityError" }); };
    const none = (): string | null => { throw new TypeError("Cannot read properties of undefined (reading 'getItem')"); };
    expect([storedNavigation(refused), storedNavigation(none)]).toEqual(["shown", "shown"]);
  });

  it("says on the button what a press of it will do", () => {
    expect([navigationWords(true), navigationWords(false)]).toEqual(["Hide navigation", "Show navigation"]);
  });

  it("takes a window for narrow by its width alone", () => {
    expect(NARROW_WINDOW).toMatch(/^\(max-width:\d+px\)$/);
  });
});
