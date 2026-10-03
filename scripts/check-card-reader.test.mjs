import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareCardReader, READER_FILES, ROOT } from './check-card-reader.mjs';

// Hermetic: compares this repository's reader (read only) with copies in temporary folders; no SAM checkout is needed.
const SCRIPT = fileURLToPath(new URL('./check-card-reader.mjs', import.meta.url));
const TEMP_PREFIX = path.join(os.tmpdir(), 'cardigan-card-reader-');

function withTemp(run) {
  const dir = mkdtempSync(TEMP_PREFIX);
  try { return run(dir); } finally {
    assert.ok(dir.startsWith(TEMP_PREFIX));
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A stand-in SAM checkout holding copies of this repository's five reader files. */
function samCopy(dir) {
  const sam = path.join(dir, 'anaplan-sam');
  mkdirSync(path.join(sam, 'src', 'domains', 'ux-designer'), { recursive: true });
  for (const file of READER_FILES) cpSync(path.join(ROOT, 'src', 'card-reader', file), path.join(sam, 'src', 'domains', 'ux-designer', file));
  return sam;
}

const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

test('names the five reader source files, and they all exist here', () => {
  assert.deepEqual(READER_FILES, ['card-details.ts', 'card-naming.ts', 'card-types.ts', 'definition-json.ts', 'definition-types.ts']);
  withTemp(dir => assert.deepEqual(compareCardReader({ sam: samCopy(dir) }), { status: 'same', differences: [] }));
});

test('reports each file that differs or is missing on either side', () => withTemp(dir => {
  const sam = samCopy(dir);
  appendFileSync(path.join(sam, 'src', 'domains', 'ux-designer', 'card-naming.ts'), '\n');
  rmSync(path.join(sam, 'src', 'domains', 'ux-designer', 'definition-types.ts'));
  assert.deepEqual(compareCardReader({ sam }), { status: 'drift', differences: [{ file: 'card-naming.ts', reason: 'differs' }, { file: 'definition-types.ts', reason: 'missing in SAM' }] });

  const here = path.join(dir, 'cardigan');
  mkdirSync(path.join(here, 'src', 'card-reader'), { recursive: true });
  for (const file of READER_FILES.slice(1)) cpSync(path.join(ROOT, 'src', 'card-reader', file), path.join(here, 'src', 'card-reader', file));
  assert.deepEqual(compareCardReader({ dir: here, sam: samCopy(path.join(dir, 'clean')) }), { status: 'drift', differences: [{ file: 'card-details.ts', reason: 'missing here' }] });
}));

test('from the command line: exit 0 when identical or skipped, 1 on drift, 2 for a folder that is not SAM', () => withTemp(dir => {
  const sam = samCopy(dir);
  let result = run(sam);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Card reader matches SAM at .*: card-details\.ts, card-naming\.ts, card-types\.ts, definition-json\.ts, definition-types\.ts are identical\.\n$/);

  appendFileSync(path.join(sam, 'src', 'domains', 'ux-designer', 'card-types.ts'), '// edited\n');
  result = run(sam);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^Card reader drift against SAM at .*:\n {2}card-types\.ts: differs\nMake the five files identical/);

  result = run(path.join(dir, 'no-such-checkout'));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Card reader check skipped: there is no anaplan-sam checkout at .*no-such-checkout\. Pass its path/);

  result = run(dir);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /is not an anaplan-sam checkout: it has no src\/domains\/ux-designer\//);
}));
