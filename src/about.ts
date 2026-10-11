import { VERSION } from "./version.js";

/** The About page describes Cardigan's read-only model and app analysis, searchable tables and interactive model map.
 * Its description and privacy text live in about.html. This script gives the page the theme the results page has, the one the viewer chose there
 * or, where none was chosen, the system's, and writes the version Cardigan is at. It reads nothing else and sends nothing. */

/** Where the results page keeps the viewer's theme (results/main.ts): the extension's pages share their storage. */
export const THEME_KEY = "cardigan-theme";

/** The theme chosen on the results page, or the system's where none was or the storage cannot be read. */
export function aboutTheme(): "dark" | "light" {
  let stored: string | null = null;
  try { stored = localStorage.getItem(THEME_KEY); } catch { /* no storage: follow the system */ }
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Fills the page in: its theme and the version. */
export function showAbout(): void {
  document.documentElement.dataset.theme = aboutTheme();
  const version = document.getElementById("aboutVersion");
  if (version) version.textContent = `Version ${VERSION}`;
}

showAbout();
// A theme that follows the system changes with it.
window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => { document.documentElement.dataset.theme = aboutTheme(); });
