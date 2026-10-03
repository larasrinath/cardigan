import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { packageExtension, ROOT, runtimeFiles } from './package.mjs';

// Hermetic: packages a temporary copy of the repository's manifest and icons with stand-in bundles. It needs no build, never
// writes into the repository and never uses the network.
const TEMP_PREFIX = path.join(os.tmpdir(), 'cardigan-package-');
const RUNTIME = ['dist/content.js', 'dist/model-export.js', 'icons/128.png', 'icons/16.png', 'icons/32.png', 'icons/48.png', 'manifest.json'];
const SOURCES_AT = new Date('2026-01-01T00:00:00Z');
const BUILT_AT = new Date('2026-01-02T00:00:00Z');
const LATER = new Date('2026-01-03T00:00:00Z');

function withTemp(run) {
  const dir = mkdtempSync(TEMP_PREFIX);
  try { return run(dir); } finally {
    assert.ok(dir.startsWith(TEMP_PREFIX));
    rmSync(dir, { recursive: true, force: true });
  }
}

const write = (dir, name, text) => {
  mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
  writeFileSync(path.join(dir, name), text);
};
const touch = (dir, name, when) => utimesSync(path.join(dir, name), when, when);

/** The repository's manifest and icons, a package.json of the same version, stand-in bundles, and every kind of file that
 * must never be packaged. */
function fixture(dir) {
  const repo = path.join(dir, 'repo');
  for (const name of ['manifest.json', 'icons']) cpSync(path.join(ROOT, name), path.join(repo, name), { recursive: true });
  // The fixture's versions agree whatever the repository's say; the last test checks the repository's own.
  const { version } = JSON.parse(readFileSync(path.join(repo, 'manifest.json'), 'utf8'));
  write(repo, 'package.json', `${JSON.stringify({ name: 'cardigan', version, private: true }, null, 2)}\n`);
  const never = {
    'src/content.ts': 'export {};\n', 'src/model-content.ts': 'export {};\n', 'src/card-reader/card-details.ts': 'export {};\n',
    'src/util.test.ts': '// a test\n', 'src/guards.test-support.ts': '// test cases\n', 'scripts/build.mjs': '// build\n',
    'scripts/package.test.mjs': '// a script test\n', 'package-lock.json': '{}\n', 'docs/research/card-details.md': '# notes\n',
    'node_modules/esbuild/index.js': '// dependency\n', 'README.md': '# readme\n', 'LICENSE': 'MIT\n', '.gitignore': 'dist/\n',
    'dist/stray.js': '// not named by the manifest\n', 'dist/content.js.map': '{}\n', 'icons/source.svg': '<svg/>\n', 'icons/.DS_Store': 'x',
  };
  for (const [name, text] of Object.entries(never)) { write(repo, name, text); touch(repo, name, SOURCES_AT); }
  for (const name of ['manifest.json', 'package.json']) touch(repo, name, SOURCES_AT);
  write(repo, 'dist/content.js', '// content bundle\n(() => {})();\n');
  write(repo, 'dist/model-export.js', '// model export bundle\n(() => {})();\n');
  for (const name of ['dist/content.js', 'dist/model-export.js']) touch(repo, name, BUILT_AT);
  return repo;
}

/** Independent zip reader: end record, central directory, local headers, CRC and the stored bytes. */
function readZip(buffer) {
  const end = buffer.length - 22;
  assert.equal(buffer.readUInt32LE(end), 0x06054b50, 'end of central directory');
  assert.equal(buffer.readUInt16LE(end + 20), 0, 'no zip comment');
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    assert.equal(buffer.readUInt32LE(at), 0x02014b50);
    const [flags, method, time, date] = [8, 10, 12, 14].map(offset => buffer.readUInt16LE(at + offset));
    const [crc, compressed, size] = [16, 20, 24].map(offset => buffer.readUInt32LE(at + offset));
    const nameLength = buffer.readUInt16LE(at + 28);
    const extra = buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);
    const mode = buffer.readUInt32LE(at + 38) >>> 16;
    const offset = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extra;
    assert.equal(buffer.readUInt32LE(offset), 0x04034b50);
    assert.equal(buffer.toString('utf8', offset + 30, offset + 30 + buffer.readUInt16LE(offset + 26)), name, 'local name');
    const start = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
    const data = Buffer.from(buffer.subarray(start, start + compressed));
    assert.equal(compressed, size, `${name} stored`);
    assert.equal(zlib.crc32(data), crc, `${name} crc`);
    entries.push({ name, data, time, date, mode, method, flags });
  }
  return entries;
}

test('packages exactly the runtime files, byte for byte, with fixed metadata', () => withTemp(dir => {
  const repo = fixture(dir);
  const result = packageExtension({ dir: repo, outDir: path.join(dir, 'out') });
  const { version } = JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.equal(result.file, path.join(dir, 'out', `cardigan-${version}.zip`));
  const zip = readFileSync(result.file);
  assert.equal(result.sha256, createHash('sha256').update(zip).digest('hex'));
  assert.equal(result.bytes, zip.length);
  assert.deepEqual(result.files, RUNTIME);
  const entries = readZip(zip);
  assert.deepEqual(entries.map(entry => entry.name), RUNTIME);
  for (const entry of entries) {
    assert.ok(entry.data.equals(readFileSync(path.join(repo, entry.name))), `${entry.name} bytes`);
    // 1980-01-01 00:00, UTF-8 names, stored, regular file 0644.
    assert.deepEqual([entry.time, entry.date, entry.flags, entry.method, entry.mode], [0, 33, 0x0800, 0, 0o100644], entry.name);
  }
  assert.deepEqual(entries.filter(entry => /^(?:src|scripts|docs|node_modules)\/|\.test\.|\.map$|\.md$|LICENSE|stray|\.svg$|DS_Store/.test(entry.name)), []);
}));

test('gives the same bytes on every run, whatever the files\' times and the output folder', () => withTemp(dir => {
  const repo = fixture(dir);
  const first = readFileSync(packageExtension({ dir: repo, outDir: path.join(dir, 'a') }).file);
  const again = readFileSync(packageExtension({ dir: repo, outDir: path.join(dir, 'a') }).file);
  for (const name of RUNTIME) touch(repo, name, LATER);
  const touched = packageExtension({ dir: repo, outDir: path.join(dir, 'b') });
  assert.ok(first.equals(again));
  assert.ok(first.equals(readFileSync(touched.file)));
  assert.equal(touched.sha256, createHash('sha256').update(first).digest('hex'));
}));

test('writes to release/ in the repository by default', () => withTemp(dir => {
  const repo = fixture(dir);
  const { file } = packageExtension({ dir: repo });
  assert.equal(path.dirname(file), path.join(repo, 'release'));
}));

test('refuses to package when a bundle is missing', () => withTemp(dir => {
  const repo = fixture(dir);
  rmSync(path.join(repo, 'dist', 'model-export.js'));
  assert.throws(() => packageExtension({ dir: repo, outDir: path.join(dir, 'out') }), /dist\/model-export\.js is missing\. Run npm run build first/);
  rmSync(path.join(repo, 'dist'), { recursive: true });
  assert.throws(() => packageExtension({ dir: repo, outDir: path.join(dir, 'out') }), /dist\/content\.js is missing; dist\/model-export\.js is missing/);
  assert.equal(existsSync(path.join(dir, 'out')), false, 'nothing written');
}));

test('refuses to package a bundle older than a source it is built from, but not one older than a test', () => withTemp(dir => {
  const repo = fixture(dir);
  for (const name of ['src/card-reader/card-details.ts', 'manifest.json', 'scripts/build.mjs', 'package-lock.json']) {
    touch(repo, name, LATER);
    assert.throws(() => packageExtension({ dir: repo, outDir: path.join(dir, 'out') }),
      new RegExp(`dist/content\\.js is older than ${name.replace(/\./g, '\\.')}; dist/model-export\\.js is older than`), name);
    touch(repo, name, SOURCES_AT);
  }
  assert.equal(existsSync(path.join(dir, 'out')), false, 'nothing written');
  for (const name of ['src/util.test.ts', 'src/guards.test-support.ts', 'docs/research/card-details.md', 'README.md']) touch(repo, name, LATER);
  assert.doesNotThrow(() => packageExtension({ dir: repo, outDir: path.join(dir, 'out') }));
}));

test('refuses a manifest that names a file outside dist/*.js and icons/*.png, or a key it does not know', () => {
  const base = JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.deepEqual(runtimeFiles(base), RUNTIME);
  const withScript = js => ({ ...base, content_scripts: [{ ...base.content_scripts[0], js }] });
  for (const js of [['src/content.ts'], ['dist/../src/content.ts'], ['./dist/content.js'], ['/dist/content.js'], ['dist/sub/content.js'],
    ['node_modules/x.js'], ['docs/x.js'], ['dist/content.test.ts'], ['dist/.hidden.js'], ['dist\\content.js'], [42]]) {
    assert.throws(() => runtimeFiles(withScript(js)), /is not a dist\/\*\.js bundle or an icons\/\*\.png icon/, JSON.stringify(js));
  }
  assert.throws(() => runtimeFiles({ ...base, icons: { 16: '../16.png' } }), /"\.\.\/16\.png" is not a dist/);
  assert.throws(() => runtimeFiles({ ...base, icons: { 16: 'icons/16.svg' } }), /"icons\/16\.svg" is not a dist/);
  assert.throws(() => runtimeFiles({ ...base, background: { service_worker: 'src/background.js' } }), /"background" is not known to the packager/);
  assert.throws(() => runtimeFiles({ ...base, web_accessible_resources: [] }), /"web_accessible_resources" is not known/);
  assert.throws(() => runtimeFiles({ ...base, content_scripts: [{ ...base.content_scripts[0], css: ['x.css'] }] }), /content_scripts "css" is not known/);
});

test('refuses a version mismatch, and a bundle that is a link', () => withTemp(dir => {
  const repo = fixture(dir);
  const pkg = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8'));
  writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ ...pkg, version: '9.9.9' }));
  touch(repo, 'package.json', SOURCES_AT);
  assert.throws(() => packageExtension({ dir: repo, outDir: path.join(dir, 'out') }), /package\.json is version 9\.9\.9 but manifest\.json is/);
  writeFileSync(path.join(repo, 'package.json'), JSON.stringify(pkg));

  write(dir, 'elsewhere.js', '// outside the repository\n');
  rmSync(path.join(repo, 'dist', 'content.js'));
  symlinkSync(path.join(dir, 'elsewhere.js'), path.join(repo, 'dist', 'content.js'));
  utimesSync(path.join(dir, 'elsewhere.js'), BUILT_AT, BUILT_AT);
  assert.throws(() => packageExtension({ dir: repo, outDir: path.join(dir, 'out') }), /dist\/content\.js is not a regular file/);
  assert.equal(existsSync(path.join(dir, 'out')), false, 'nothing written');
}));

test('the repository\'s package.json and manifest.json carry the same version', () => {
  const [pkg, manifest] = ['package.json', 'manifest.json'].map(name => JSON.parse(readFileSync(path.join(ROOT, name), 'utf8')));
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.version, manifest.version);
});
