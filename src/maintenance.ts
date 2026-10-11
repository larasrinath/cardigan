/** Only a title or heading that announces maintenance counts. A model, paragraph or ordinary error merely mentioning
 * maintenance does not. These are deliberately whole phrases, not a search for the word anywhere in the page. */
export function maintenanceHeading(text: string): boolean {
  const words = text.replace(/\s*[-|:–—]\s*/g, " ").replace(/\s+/g, " ").trim();
  return /^(?:(?:anaplan|system|site|service)\s+)?(?:(?:is\s+)?(?:down for|unavailable for|under|undergoing|in)\s+)?(?:(?:scheduled|planned)\s+)?maintenance(?:\s+(?:in progress|underway|mode|notice|window))?[.!…]*$/i.test(words);
}

/** Inspect detached markup only; never insert an HTTP answer into the live page. Remove comments and scripts before
 * looking at headings, so a quoted example or script string cannot identify a maintenance page. */
export function maintenanceHtml(body: string): boolean {
  if (!/^\s*</.test(body)) return false;
  const html = body.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  return [...html.matchAll(/<(title|h[1-6])\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)].some(match =>
    maintenanceHeading(match[2].replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ")));
}

export const MAINTENANCE_MESSAGE = "Try again when it's back. Nothing was read.";
