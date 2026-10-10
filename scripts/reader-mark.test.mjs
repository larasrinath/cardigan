import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { bundleOptions, markOf, READER_ENTRY, readerMark } from './reader-mark.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test("a reader's mark is twelve hex digits of its code, its lines ended alike", () => {
  assert.match(markOf('(() => {})();\n'), /^[0-9a-f]{12}$/);
  assert.equal(markOf('a();\r\nb();\r\n'), markOf('a();\nb();\n'));
  assert.notEqual(markOf('a();\n'), markOf('b();\n'));
});

test('the mark is of what the reader does: another version gives the same mark, a comment or line endings change nothing, and a change of code gives a new one', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cardigan-mark-'));
  try {
    // The sources, and the settings esbuild takes from tsconfig.json (its strict mode is in the code).
    cpSync(path.join(root, 'src'), path.join(dir, 'src'), { recursive: true });
    cpSync(path.join(root, 'tsconfig.json'), path.join(dir, 'tsconfig.json'));
    const mark = await readerMark(dir);
    assert.match(mark, /^[0-9a-f]{12}$/);
    // Where the sources are does not count.
    assert.equal(mark, await readerMark(root));
    // The version is in the reader's bundle, and two versions make two bundles; the mark is made with neither.
    const bundled = async version => (await build({ ...bundleOptions(dir, READER_ENTRY, 'model-export.js', { __EXTENSION_VERSION__: JSON.stringify(version), __EXTENSION_BUILD__: JSON.stringify(mark) }), write: false })).outputFiles[0].text;
    const [older, newer] = [await bundled('0.13.0'), await bundled('0.14.1')];
    assert.notEqual(older, newer);
    assert.equal(older.replaceAll('0.13.0', '0.14.1'), newer);
    assert.equal(await readerMark(dir), mark);
    // A comment, and other line endings, leave the code as it was.
    const bridge = path.join(dir, 'src', 'bridge.ts');
    const source = readFileSync(bridge, 'utf8');
    writeFileSync(bridge, `/** A note that changes nothing the reader does. */\n${source}`);
    assert.equal(await readerMark(dir), mark);
    writeFileSync(bridge, source.replace(/\n/g, '\r\n'));
    assert.equal(await readerMark(dir), mark);
    // A change of what the reader does is a new mark: here, how often it announces itself.
    assert.ok(source.includes('announceMs = 2000'));
    writeFileSync(bridge, source.replace('announceMs = 2000', 'announceMs = 2001'));
    assert.notEqual(await readerMark(dir), mark);
    // What only the page around the frame does, or what nothing uses, is not in the reader's code: no new mark.
    writeFileSync(bridge, source.replace('const OPEN_WAIT_MS = 700;', 'const OPEN_WAIT_MS = 701;'));
    assert.equal(await readerMark(dir), mark);
    writeFileSync(bridge, source);
    const util = path.join(dir, 'src', 'util.ts');
    writeFileSync(util, `${readFileSync(util, 'utf8')}\nexport const NEVER_USED = 1;\n`);
    assert.equal(await readerMark(dir), mark);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the build says the mark it gave every bundle, and the version of the manifest', () => {
  // The build that `npm run check` has just made: its banner names the version and the mark of the reader's code.
  const { version } = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const banners = ['content.js', 'model-export.js', 'background.js', 'results.js'].map(file => readFileSync(path.join(root, 'dist', file), 'utf8').split('\n')[0]);
  const [first] = banners;
  assert.match(first, new RegExp(`^// Cardigan ${version.replaceAll('.', '\\.')}, model reader [0-9a-f]{12}\\. `));
  assert.deepEqual(banners, banners.map(() => first));
});
