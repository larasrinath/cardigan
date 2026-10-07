/** The navigation of the results page can be put away and brought back by one button (main.ts). What the page's script
 * and its stylesheet must agree on, what the button says, and what is remembered are said here, once. */

/** The window is narrow where this holds, which is where the stylesheet's narrow layout holds (results.css): there the
 * navigation slides in over the content and out again. In a wider window it stands beside the content, and the button
 * puts it away in place: the content then takes the whole width. */
export const NARROW_WINDOW = "(max-width:1120px)";

/** Whether the navigation of a wide window is put away. */
export type NavigationChoice = "hidden" | "shown";

/** The name the choice is remembered under for this browser, as the colour theme is under its own. It is a convenience
 * of this browser only, and the one thing kept about the navigation. */
export const NAVIGATION_KEY = "cardigan-navigation";

/** What was chosen last, as far as the browser kept it: the navigation is shown unless the browser holds "hidden".
 * `read` reads the browser's store, which a browser may refuse to do, or to have: the navigation is shown then too. */
export function storedNavigation(read: (key: string) => string | null): NavigationChoice {
  let stored: string | null = null;
  try { stored = read(NAVIGATION_KEY); } catch { /* no store: the navigation is shown */ }
  return stored === "hidden" ? "hidden" : "shown";
}

/** What the button says, as its name and as its title: what a press of it will do. */
export const navigationWords = (shown: boolean): string => (shown ? "Hide navigation" : "Show navigation");
