/** Set by the build from manifest.json, which is bumped on every rebuild, so each export's details and the first line of
 * its diagnostic log say which build made them. */
declare const __EXTENSION_VERSION__: string;
export const VERSION = typeof __EXTENSION_VERSION__ === "string" ? __EXTENSION_VERSION__ : "dev";

/** Set by the build from the version and the sources of the model's reader, model-content.ts and what it bundles
 * (scripts/build.mjs): the same in every bundle of one build, and another in a build that changes the reader. The reader
 * says it when it checks in, and the content script reads a model only with a reader of its own build (bridge.ts
 * `exportInCore`). */
declare const __EXTENSION_BUILD__: string;
export const BUILD = typeof __EXTENSION_BUILD__ === "string" ? __EXTENSION_BUILD__ : "dev";
