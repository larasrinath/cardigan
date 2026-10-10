import { createHash } from 'node:crypto';
import path from 'node:path';
import { build } from 'esbuild';

/** The entry point of the model's reader, dist/model-export.js, under src. */
export const READER_ENTRY = 'model-content.ts';

/** esbuild's options for one of the extension's bundles: `entry` under src, bundled to `outfile` under dist, with `define`.
 * Unminified, so the loaded code stays reviewable. */
export function bundleOptions(root, entry, outfile, define) {
  return {
    absWorkingDir: root,
    entryPoints: [path.join(root, 'src', entry)],
    outfile: path.join(root, 'dist', outfile),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome111'],
    charset: 'utf8',
    legalComments: 'none',
    logLevel: 'warning',
    define,
  };
}

/** The mark of a reader's code: twelve hex digits of its hash, its lines ended alike. */
export function markOf(code) {
  return createHash('sha256').update(code.replace(/\r\n/g, '\n')).digest('hex').slice(0, 12);
}

/** The mark of the model's reader, as the sources under `root` bundle it. The reader says its mark when it checks in, and
 * the content script reads a model only with a reader of its own mark (src/bridge.ts): a tab keeps the reader it loaded
 * with until it is refreshed, through an update of the extension too. So the mark is made from the reader's code alone,
 * as esbuild writes it, with the version and the mark itself in it as placeholders. It changes with what the reader
 * does, and with nothing else: not with the version, which every update changes (CHANGELOG.md), nor with a comment, which
 * the code does not hold. An update that leaves the reader's code as it was leaves an open model's tab as good as
 * refreshed. The version the reader writes into an export is put right by the content script (src/version-label.ts). */
export async function readerMark(root) {
  const placeholders = { __EXTENSION_VERSION__: JSON.stringify('version'), __EXTENSION_BUILD__: JSON.stringify('mark') };
  const { outputFiles } = await build({ ...bundleOptions(root, READER_ENTRY, 'model-export.js', placeholders), write: false });
  return markOf(outputFiles[0].text);
}
