/** The elements results.html itself holds that the page's script looks up by ID. A test checks that results.html has each
 * of them exactly once, so the page and its script cannot drift apart unnoticed. */
export const PAGE_IDS = [
  "version", "hdMeta", "runAgain", "themeToggle", "topnav", "navList", "navCompact", "banners", "view", "mapHost",
  "scrim", "drawer", "drawerTitle", "drawerSub", "drawerClose", "drawerBody", "popover", "toast", "live",
] as const;
export type PageId = (typeof PAGE_IDS)[number];
