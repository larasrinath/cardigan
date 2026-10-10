/** Set by the build from manifest.json, whose version every merged change to the extension bumps, so each export's
 * details and the first line of its diagnostic log say which version made them. A model's export says the content
 * script's, whichever the model's reader is of (version-label.ts). */
declare const __EXTENSION_VERSION__: string;
export const VERSION = typeof __EXTENSION_VERSION__ === "string" ? __EXTENSION_VERSION__ : "dev";

/** Set by the build from the code of the model's reader, model-content.ts and what it bundles, and from nothing else
 * (scripts/reader-mark.mjs): the same in every bundle of one build, the same across versions that leave the reader's
 * code as it was, and another in a build that changes it. The reader says it when it checks in, and the content script
 * reads a model only with a reader of its own build (bridge.ts `exportInCore`). */
declare const __EXTENSION_BUILD__: string;
export const BUILD = typeof __EXTENSION_BUILD__ === "string" ? __EXTENSION_BUILD__ : "dev";
