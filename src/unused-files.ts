/** The two tables a model's run makes of what nothing in the model uses, once the pages built on the model are read
 * (model/unused.ts makes them in the Anaplan tab; the results page lists them under Modules, after Dynamic Cell Access).
 * Named here, apart from that work, so that the results page knows them by name without taking in what makes them. */

export const UNUSED_LINE_ITEMS = "Unused Line Items";
export const UNUSED_MODULES = "Unused Modules";
export const UNUSED_LINE_ITEMS_FILE = `${UNUSED_LINE_ITEMS}.csv`;
export const UNUSED_MODULES_FILE = `${UNUSED_MODULES}.csv`;

/** Each line item nothing uses, in Line Items' order: its name and its module's, why it is listed, and its own cells of
 * Line Items, its Format said in words. The last two start hidden. */
export const UNUSED_LINE_ITEMS_HEADERS: readonly string[] = ["Line Item", "Module", "Why", "Format", "Cell Count", "Notes", "Formula", "Referenced By"];
/** Each module nothing uses, in Modules' order: its name, why it is listed, how many line items it has (headings aside), and
 * its own cells of Modules. Notes starts hidden. */
export const UNUSED_MODULES_HEADERS: readonly string[] = ["Module", "Why", "Line Items", "Cell Count", "Functional Area", "Notes"];

/** What Why says of a row: one reason each. */
export const WHY = {
  /** A line item that nothing uses at all. */
  readByNothing: "Read by nothing",
  /** A line item whose every use is by line items that are unused themselves: a dead chain. */
  onlyFeedsUnused: "Only feeds unused line items",
  /** A line item an import loads into, which nothing in use reads or shows. */
  importedNeverRead: "Imported, never read",
  /** A module with no line items but headings. */
  empty: "Empty",
  /** A module whose every line item, headings aside, is unused. */
  noLineItemUsed: "No line item used",
} as const;

/** The line under both tables' names: what unused means here, and what Cardigan cannot see. */
export const UNUSED_CAVEAT = "Unused means no use Cardigan can see: other models' imports, API reads, line items hidden in saved views and Workflow aren't visible.";

/** The detail of the Details rows under Notes that say what the run could not see for the two tables: the results page shows
 * them on the Overview and under both tables' names. */
export const UNUSED_NOTES = UNUSED_LINE_ITEMS;
