/** Names for the page's two downloads. A result names its own zip and its files, and in the normal flow those names are
 * safe: the analysis writes them without the characters a file name cannot hold (util.ts `fileSafe`). The page does not
 * rely on the sender for that. Before a name is given to a download it must be a plain file name; anything else gets a
 * fixed name instead. */

/** What a plain file name does not hold: a path separator or another character some system refuses in a file name, a
 * control character or a line separator, or a character that sets the direction of the text after it, with which a name
 * can show an ending it does not have. */
const NOT_PLAIN = /[\\/:*?"<>|\p{Cc}\p{Zl}\p{Zp}\p{Bidi_Control}]/u;

export const ZIP_FALLBACK = "Cardigan export.zip";
export const CSV_FALLBACK = "table.csv";

/** `name` when it is a plain file name that ends in `extension` and does not start with a dot, otherwise `fallback`. */
export function downloadName(name: unknown, extension: ".zip" | ".csv", fallback: string): string {
  const plain = typeof name === "string" && name.length > extension.length && name.endsWith(extension) && !name.startsWith(".") && !NOT_PLAIN.test(name);
  return plain ? name : fallback;
}
