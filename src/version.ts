/** Set by the build from manifest.json, which is bumped on every rebuild, so the panel title and each export's details say
 * which build made them. */
declare const __EXTENSION_VERSION__: string;
export const VERSION = typeof __EXTENSION_VERSION__ === "string" ? __EXTENSION_VERSION__ : "dev";
