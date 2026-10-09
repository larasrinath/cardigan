import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { PAGE_SHEETS, packageExtension, pageProblems, policyProblems, ROOT, runtimeFiles, staleBundles } from './package.mjs';

// Hermetic: packages a temporary copy of the repository's manifest and icons with stand-in bundles and a stand-in results
// page. It needs no build, never writes into the repository and never uses the network. One test, the last, reads the
// repository's own build: it is skipped where there is none, or one older than its sources. `npm run check` builds
// before it runs these tests, so there it always runs.
const TEMP_PREFIX = path.join(os.tmpdir(), 'cardigan-package-');
const BUNDLES = ['dist/background.js', 'dist/content.js', 'dist/model-export.js', 'dist/results.js'];
const RUNTIME = [...BUNDLES, 'icons/128.png', 'icons/16.png', 'icons/32.png', 'icons/48.png', 'manifest.json', 'map.css', 'results.css', 'results.html'];
const EARLIER = new Date('2025-12-31T00:00:00Z');
const SOURCES_AT = new Date('2026-01-01T00:00:00Z');
const BUILT_AT = new Date('2026-01-02T00:00:00Z');
const LATER = new Date('2026-01-03T00:00:00Z');
/** A stand-in results page and its two stylesheets, the page's own and the model map's. They load only packaged files (the
 * stylesheets, the bundle and icons); a link to follow, a place in the page and inline data load no file. */
const PAGE = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Cardigan</title>\n<link rel="icon" href="icons/32.png">\n'
  + '<link rel="stylesheet" href="results.css">\n<link rel="stylesheet" href="map.css">\n</head>\n<body>\n<h1><img src="icons/48.png" alt=""> Cardigan</h1>\n'
  + '<p><a href="https://help.anaplan.com/">Anaplan help</a> <a href="#results">Results</a></p>\n<main id="results"></main>\n'
  + '<script src="dist/results.js"></script>\n</body>\n</html>\n';
const STYLES = 'body { margin: 0; background: url("icons/128.png") no-repeat; }\n'
  + '.mark { mask: url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\'/%3E"); fill: url(#shade); }\n';
const MAP_STYLES = '.map-canvas { display: block; cursor: url("icons/16.png"), grab; }\n.map-edge { marker-end: url(#arrow); }\n';
/** The text of each of the page's stylesheets by its name, as `pageProblems` takes them: the page's own, and the map's. */
const sheets = (own = '', map = '') => ({ 'results.css': own, 'map.css': map });

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
/** `name` as the text of a pattern that matches only that name. */
const literal = name => name.replace(/\./g, '\\.');

/** The repository's manifest and icons, a package.json of the same version, stand-in bundles, a stand-in results page, and
 * every kind of file that must never be packaged. */
function fixture(dir) {
  const repo = path.join(dir, 'repo');
  for (const name of ['manifest.json', 'icons']) cpSync(path.join(ROOT, name), path.join(repo, name), { recursive: true });
  // The fixture's versions agree whatever the repository's say; the last test checks the repository's own.
  const { version } = JSON.parse(readFileSync(path.join(repo, 'manifest.json'), 'utf8'));
  write(repo, 'package.json', `${JSON.stringify({ name: 'cardigan', version, private: true }, null, 2)}\n`);
  const never = {
    'src/content.ts': 'export {};\n', 'src/model-content.ts': 'export {};\n', 'src/card-reader/card-details.ts': 'export {};\n',
    'src/background.ts': 'export {};\n', 'src/results/main.ts': 'export {};\n', 'src/results/main.test.ts': '// a test\n',
    'src/util.test.ts': '// a test\n', 'src/guards.test-support.ts': '// test cases\n', 'scripts/build.mjs': '// build\n',
    'scripts/package.test.mjs': '// a script test\n', 'package-lock.json': '{}\n', 'docs/notes.md': '# notes\n',
    'node_modules/esbuild/index.js': '// dependency\n', 'README.md': '# readme\n', 'LICENSE': 'MIT\n', '.gitignore': 'dist/\n',
    'dist/stray.js': '// not named by the manifest\n', 'dist/content.js.map': '{}\n', 'icons/source.svg': '<svg/>\n', 'icons/.DS_Store': 'x',
    'index.html': '<!doctype html>\n<title>Not the results page</title>\n', 'results.css.map': '{}\n', 'dist/results.css': '/* not the stylesheet */\n',
    'src/map/map-view.ts': 'export {};\n', 'src/map/map-view.test.ts': '// a test\n', 'map.css.map': '{}\n', 'dist/map.css': '/* not the map\'s stylesheet */\n',
  };
  for (const [name, text] of Object.entries(never)) { write(repo, name, text); touch(repo, name, SOURCES_AT); }
  for (const name of ['manifest.json', 'package.json']) touch(repo, name, SOURCES_AT);
  write(repo, 'results.html', PAGE);
  write(repo, 'results.css', STYLES);
  write(repo, 'map.css', MAP_STYLES);
  write(repo, 'dist/content.js', '// content bundle\n(() => {})();\n');
  write(repo, 'dist/model-export.js', '// model export bundle\n(() => {})();\n');
  write(repo, 'dist/background.js', '// service worker bundle\n(() => {})();\n');
  write(repo, 'dist/results.js', '// results page bundle\n(() => {})();\n');
  for (const name of BUNDLES) touch(repo, name, BUILT_AT);
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
  assert.deepEqual(entries.filter(entry => /^(?:src|scripts|docs|node_modules)\/|\.test\.|\.map$|\.md$|LICENSE|stray|\.svg$|DS_Store|^index\.html$|^dist\/.*\.css$/.test(entry.name)), []);
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
  // Each of the four on its own: the content scripts, the service worker and the results page's script.
  for (const bundle of BUNDLES) {
    const kept = readFileSync(path.join(repo, bundle));
    rmSync(path.join(repo, bundle));
    assert.throws(() => packageExtension({ dir: repo, outDir: path.join(dir, 'out') }), new RegExp(`^Error: Cannot package: ${literal(bundle)} is missing\\. Run npm run build first`), bundle);
    write(repo, bundle, kept);
    touch(repo, bundle, BUILT_AT);
  }
  rmSync(path.join(repo, 'dist', 'model-export.js'));
  assert.throws(() => packageExtension({ dir: repo, outDir: path.join(dir, 'out') }), /dist\/model-export\.js is missing\. Run npm run build first/);
  rmSync(path.join(repo, 'dist'), { recursive: true });
  assert.throws(() => packageExtension({ dir: repo, outDir: path.join(dir, 'out') }),
    /dist\/background\.js is missing; dist\/content\.js is missing; dist\/model-export\.js is missing; dist\/results\.js is missing\. Run npm run build first/);
  assert.equal(existsSync(path.join(dir, 'out')), false, 'nothing written');
}));

test('refuses to package when the results page or one of its stylesheets is missing', () => withTemp(dir => {
  const repo = fixture(dir);
  for (const name of ['results.html', 'results.css', 'map.css']) {
    const kept = readFileSync(path.join(repo, name));
    rmSync(path.join(repo, name));
    assert.throws(() => packageExtension({ dir: repo, outDir: path.join(dir, 'out') }), new RegExp(`^Error: Cannot package: ${literal(name)} is missing$`), name);
    write(repo, name, kept);
  }
  assert.equal(existsSync(path.join(dir, 'out')), false, 'nothing written');
  assert.doesNotThrow(() => packageExtension({ dir: repo, outDir: path.join(dir, 'out') }));
}));

test('refuses a results page that loads a file outside the package, or does not load its own stylesheets and bundle', () => withTemp(dir => {
  const repo = fixture(dir);
  /** Packaging with `name` changed stops with exactly these problems. `name` is then put back. */
  const refused = (name, change, ...problems) => {
    const kept = readFileSync(path.join(repo, name), 'utf8');
    write(repo, name, change(kept));
    assert.throws(() => packageExtension({ dir: repo, outDir: path.join(dir, 'out') }), { message: `Cannot package:\n${problems.join('\n')}` });
    write(repo, name, kept);
  };
  // A file that is on disk but not in the package, and files that are only on the network.
  refused('results.html', page => page.replace('</body>', '<script src="dist/stray.js"></script>\n</body>'), 'results.html loads "dist/stray.js", which is not packaged');
  refused('results.html', page => page.replace('</head>', '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">\n</head>'),
    'results.html loads "https://fonts.googleapis.com/css2?family=Inter", which is not packaged');
  refused('results.css', styles => `@import "theme.css";\n${styles}@font-face { font-family: Inter; src: url(https://fonts.gstatic.com/inter.woff2); }\n`,
    'results.css loads "theme.css", which is not packaged', 'results.css loads "https://fonts.gstatic.com/inter.woff2", which is not packaged');
  // The model map's stylesheet is held to the package as the page's own is, and is named when it is the one that strays.
  refused('map.css', styles => `@import "map-theme.css";\n${styles}.map-legend { background: url(https://example.com/legend.png); }\n`,
    'map.css loads "map-theme.css", which is not packaged', 'map.css loads "https://example.com/legend.png", which is not packaged');
  // A packaged file under another spelling is not the packaged file.
  refused('results.html', page => page.replace('href="results.css"', 'href="./results.css"').replace('src="dist/results.js"', 'src="/dist/results.js?v=1"'),
    'results.html loads "./results.css", which is not packaged', 'results.html loads "/dist/results.js?v=1", which is not packaged',
    'results.html does not load results.css', 'results.html does not load dist/results.js');
  // A page without its bundle, or without one of its stylesheets.
  refused('results.html', page => page.replace('<script src="dist/results.js"></script>\n', ''), 'results.html does not load dist/results.js');
  refused('results.html', page => page.replace('<link rel="stylesheet" href="results.css">\n', ''), 'results.html does not load results.css');
  refused('results.html', page => page.replace('<link rel="stylesheet" href="map.css">\n', ''), 'results.html does not load map.css');
  refused('results.html', page => page.replace('href="map.css"', 'href="src/map/map.css"'), 'results.html loads "src/map/map.css", which is not packaged', 'results.html does not load map.css');
  assert.equal(existsSync(path.join(dir, 'out')), false, 'nothing written');
  assert.doesNotThrow(() => packageExtension({ dir: repo, outDir: path.join(dir, 'out') }));
}));

test('finds what a page and its styles load however it is written, and nothing in a link to follow, a place in the page or inline data', () => {
  const own = '<link rel="stylesheet" href="results.css"><link rel="stylesheet" href="map.css"><script src="dist/results.js"></script>';
  /** The addresses refused in a page that also loads its own three files, in its styles, and in the model map's. */
  const refused = (page, styles = '', map = '') => pageProblems(`${own}${page}`, sheets(styles, map), RUNTIME)
    .map(problem => /^(?:results\.html|results\.css|map\.css) loads "(.*)", which is not packaged$/.exec(problem)?.[1] ?? problem);
  assert.deepEqual(PAGE_SHEETS, ['results.css', 'map.css']);
  assert.deepEqual(pageProblems(own, sheets(), RUNTIME), []);
  assert.deepEqual(pageProblems(PAGE, sheets(STYLES, MAP_STYLES), RUNTIME), []);
  for (const [page, addresses] of [
    ['<script defer src=\'other.js\'></script>', ['other.js']],
    ['<SCRIPT SRC=other.js></SCRIPT>', ['other.js']],
    ['<script\n  src = "other.js"\n></script>', ['other.js']],
    ['<LINK HREF="other.css" REL="stylesheet" />', ['other.css']],
    ['<img alt="a > b" src="logo.png"><iframe src="https://example.com/"></iframe>', ['logo.png', 'https://example.com/']],
    ['<img src="logo.png"><img src="logo.png">', ['logo.png']],
    ['<p style="background: url(tile.png)">x</p><style>@import "more.css"; a { background: url(\'b.png\') }</style>', ['tile.png', 'more.css', 'b.png']],
    // The page is not parsed as HTML: a tag inside a comment counts too.
    ['<!-- <script src="old.js"></script> -->', ['old.js']],
    // Packaged files.
    ['<img src="icons/16.png"><link rel="icon" href="icons/128.png">', []],
    // Nothing to load: links to follow, places in the page, an empty address, inline data, and text that only looks like an attribute.
    ['<a href="https://help.anaplan.com/">Help</a><a href="other.html">Other</a><a href="#top">Top</a><svg><use href="#mark"/></svg>', []],
    ['<img src="" alt=""><img src="data:image/png;base64,AAAA"><img data-src="lazy.png">', []],
    ['<input disabled value="src=no.js"><a title="x src=\'no.js\'">t</a><p>if a <b and c> d then src="no.js"</p>', []],
    ['<p>URL.createObjectURL(blob), then URL.revokeObjectURL(a.href)</p>', []],
  ]) assert.deepEqual(refused(page), addresses, page);
  for (const [styles, addresses] of [
    ['@import url(extra.css); @IMPORT URL("more.css"); @import \'last.css\' screen;', ['extra.css', 'more.css', 'last.css']],
    ['a { background: image-set(url( "a.png" ) 1x, url(b.png) 2x); }', ['a.png', 'b.png']],
    ['a{background:url(c.png)}b{background:#fff URL(d.png),url(e.png)}', ['c.png', 'd.png', 'e.png']],
    ['@font-face { src: local("Inter"), url(fonts/inter.woff2) format("woff2"); }', ['fonts/inter.woff2']],
    ['a { background: url(icons/16.png); }', []],
    ['a { mask: url(data:image/svg+xml,%3Csvg%3E%3C/svg%3E); fill: url(#shade); background: url(); }', []],
    ['a { background: url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\'><path fill=\'url(%23g)\'/></svg>"); }', []],
  ]) {
    assert.deepEqual(refused('', styles), addresses, styles);
    // The model map's stylesheet is read the same way, and each problem names the stylesheet that has it.
    assert.deepEqual(refused('', '', styles), addresses, styles);
    assert.deepEqual(pageProblems(own, sheets('', styles), RUNTIME), addresses.map(address => `map.css loads ${JSON.stringify(address)}, which is not packaged`), styles);
  }
});

test('refuses to package a bundle older than a source it is built from, but not one older than a test', () => withTemp(dir => {
  const repo = fixture(dir);
  // The model map's code is part of the results page's bundle: a bundle older than one of its sources is as stale.
  for (const name of ['src/card-reader/card-details.ts', 'src/background.ts', 'src/results/main.ts', 'src/map/map-view.ts', 'manifest.json', 'scripts/build.mjs', 'package-lock.json']) {
    touch(repo, name, LATER);
    assert.throws(() => packageExtension({ dir: repo, outDir: path.join(dir, 'out') }),
      new RegExp(`^Error: Cannot package: ${BUNDLES.map(bundle => `${literal(bundle)} is older than ${literal(name)}`).join('; ')}\\. Run npm run build first`), name);
    touch(repo, name, SOURCES_AT);
  }
  // One bundle left behind by a build: the others are current, and it alone is refused.
  for (const bundle of BUNDLES) {
    touch(repo, bundle, EARLIER);
    assert.throws(() => packageExtension({ dir: repo, outDir: path.join(dir, 'out') }), new RegExp(`^Error: Cannot package: ${literal(bundle)} is older than manifest\\.json\\. Run npm run build first`), bundle);
    touch(repo, bundle, BUILT_AT);
  }
  assert.equal(existsSync(path.join(dir, 'out')), false, 'nothing written');
  // The page and its stylesheets are packaged as they are: no bundle is built from them.
  for (const name of ['src/util.test.ts', 'src/guards.test-support.ts', 'src/results/main.test.ts', 'src/map/map-view.test.ts', 'docs/notes.md', 'README.md', 'results.html', 'results.css',
    'map.css']) touch(repo, name, LATER);
  assert.doesNotThrow(() => packageExtension({ dir: repo, outDir: path.join(dir, 'out') }));
}));

test('refuses a manifest that names a file outside dist/*.js and icons/*.png, or a key it does not know', () => {
  const base = JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.deepEqual(runtimeFiles(base), RUNTIME);
  const withScript = js => ({ ...base, content_scripts: [{ ...base.content_scripts[0], js }] });
  for (const js of [['src/content.ts'], ['dist/../src/content.ts'], ['./dist/content.js'], ['/dist/content.js'], ['dist/sub/content.js'],
    ['node_modules/x.js'], ['docs/x.js'], ['dist/content.test.ts'], ['dist/.hidden.js'], ['dist\\content.js'], [42]]) {
    assert.throws(() => runtimeFiles(withScript(js)), /is not a dist\/\*\.js bundle or an icons\/\*\.png icon/, JSON.stringify(js));
    // The service worker is held to the same places.
    assert.throws(() => runtimeFiles({ ...base, background: { service_worker: js[0] } }), /is not a dist\/\*\.js bundle or an icons\/\*\.png icon/, JSON.stringify(js));
  }
  assert.throws(() => runtimeFiles({ ...base, icons: { 16: '../16.png' } }), /"\.\.\/16\.png" is not a dist/);
  assert.throws(() => runtimeFiles({ ...base, icons: { 16: 'icons/16.svg' } }), /"icons\/16\.svg" is not a dist/);
  assert.throws(() => runtimeFiles({ ...base, background: { service_worker: 'src/background.js' } }), /"src\/background\.js" is not a dist/);
  assert.throws(() => runtimeFiles({ ...base, background: { ...base.background, type: 'module' } }), /background "type" is not known to the packager/);
  assert.throws(() => runtimeFiles({ ...base, background: { scripts: ['dist/background.js'] } }), /background "scripts" is not known to the packager/);
  // The toolbar icon's own icons, given per size or as one file; a popup is a page the packager does not know.
  assert.throws(() => runtimeFiles({ ...base, action: { ...base.action, default_icon: { 16: 'icons/16.svg' } } }), /"icons\/16\.svg" is not a dist/);
  assert.throws(() => runtimeFiles({ ...base, action: { ...base.action, default_icon: '../16.png' } }), /"\.\.\/16\.png" is not a dist/);
  assert.deepEqual(runtimeFiles({ ...base, action: { ...base.action, default_icon: 'icons/16.png' } }), RUNTIME);
  assert.throws(() => runtimeFiles({ ...base, action: { ...base.action, default_popup: 'popup.html' } }), /action "default_popup" is not known to the packager/);
  assert.throws(() => runtimeFiles({ ...base, web_accessible_resources: [] }), /"web_accessible_resources" is not known/);
  assert.throws(() => runtimeFiles({ ...base, options_page: 'options.html' }), /"options_page" is not known/);
  assert.throws(() => runtimeFiles({ ...base, side_panel: { default_path: 'panel.html' } }), /"side_panel" is not known/);
  // Cardigan asks for activeTab and scripting and nothing else, so a manifest that asks for more, or for host access, is not
  // packaged either.
  assert.deepEqual(base.permissions, ['activeTab', 'scripting']);
  for (const permissions of [['tabs'], ['activeTab', 'scripting', 'tabs'], ['scripting'], ['scripting', 'activeTab'], 'activeTab']) {
    assert.throws(() => runtimeFiles({ ...base, permissions }), /manifest\.json: "permissions" may hold only activeTab and scripting/, JSON.stringify(permissions));
  }
  for (const key of ['host_permissions', 'optional_permissions', 'optional_host_permissions']) {
    assert.throws(() => runtimeFiles({ ...base, [key]: ['tabs'] }), new RegExp(`manifest\\.json: "${key}" is not known to the packager`), key);
  }
  assert.throws(() => runtimeFiles({ ...base, content_scripts: [{ ...base.content_scripts[0], css: ['x.css'] }] }), /content_scripts "css" is not known/);
});

test('takes a content security policy only for the extension\'s own pages, and only one that lets in nothing from outside the package', () => {
  const base = JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const POLICY = "default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'";
  const withPolicies = policies => ({ ...base, content_security_policy: policies });
  const allows = (source, directive) => `allows ${source} in ${directive}, which is not 'self' or 'none'`;
  const NO_DEFAULT = 'has no default-src, so what it does not list could come from anywhere';
  // Policies that keep everything inside the package, however they are spelt and spaced. Styles may be written in the page.
  for (const policy of [POLICY, "default-src 'self'", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; style-src-elem 'unsafe-inline'",
    "  default-src 'none' ;script-src   'self';; ", "DEFAULT-SRC 'NONE'; Script-Src 'Self'; Style-Src-Attr 'Unsafe-Inline'",
    "default-src 'none'; script-src; frame-ancestors 'none'; upgrade-insecure-requests"]) {
    assert.deepEqual(policyProblems(policy), [], policy);
    assert.deepEqual(runtimeFiles(withPolicies({ extension_pages: policy })), RUNTIME, policy);
  }
  for (const [policy, ...problems] of [
    // A remote source: an address, a host, a scheme. Reports sent out count too.
    ["default-src 'none'; script-src 'self' https://cdn.example.com", allows('https://cdn.example.com', 'script-src')],
    ["default-src 'none'; connect-src api.example.com:443", allows('api.example.com:443', 'connect-src')],
    ["default-src 'none'; img-src 'self' https:", allows('https:', 'img-src')],
    ["default-src 'none'; script-src 'self' http://localhost:8000", allows('http://localhost:8000', 'script-src')],
    ["default-src 'none'; font-src data:; img-src 'self' blob:", allows('data:', 'font-src'), allows('blob:', 'img-src')],
    ["default-src 'none'; report-uri https://reports.example.com/csp", allows('https://reports.example.com/csp', 'report-uri')],
    // A wildcard, alone or in a host.
    ['default-src *', allows('*', 'default-src')],
    ["default-src 'none'; img-src *", allows('*', 'img-src')],
    ["default-src 'none'; connect-src https://*.example.com", allows('https://*.example.com', 'connect-src')],
    // Code that is not a packaged file: text run as code, and scripts written in the page, by any directive that covers scripts.
    ["default-src 'none'; script-src 'self' 'unsafe-eval'", allows("'unsafe-eval'", 'script-src')],
    ["default-src 'none'; script-src 'self' 'wasm-unsafe-eval'", allows("'wasm-unsafe-eval'", 'script-src')],
    ["default-src 'none'; script-src 'self' 'unsafe-inline'", allows("'unsafe-inline'", 'script-src')],
    ["default-src 'self' 'unsafe-inline'", allows("'unsafe-inline'", 'default-src')],
    ["default-src 'none'; script-src-elem 'unsafe-inline'; script-src-attr 'UNSAFE-INLINE'", allows("'unsafe-inline'", 'script-src-elem'), allows("'UNSAFE-INLINE'", 'script-src-attr')],
    ["default-src 'none'; script-src 'self' 'nonce-abc' 'sha256-AAAA' 'strict-dynamic'", allows("'nonce-abc'", 'script-src'), allows("'sha256-AAAA'", 'script-src'), allows("'strict-dynamic'", 'script-src')],
    // Without default-src, what the policy does not list is open.
    ["script-src 'self'; style-src 'self'", NO_DEFAULT],
    // Every problem is named, not only the first.
    ["script-src 'self' 'unsafe-eval' https://cdn.example.com; img-src *", allows("'unsafe-eval'", 'script-src'), allows('https://cdn.example.com', 'script-src'), allows('*', 'img-src'), NO_DEFAULT],
  ]) {
    assert.deepEqual(policyProblems(policy), problems, policy);
    assert.throws(() => runtimeFiles(withPolicies({ extension_pages: policy })),
      { message: `Cannot package:\n${problems.map(problem => `manifest.json: content_security_policy "extension_pages" ${problem}`).join('\n')}` }, policy);
  }
  // Not a policy at all.
  for (const policy of [undefined, null, '', '   ', 42, ["default-src 'none'"], { 'default-src': "'none'" }]) {
    assert.deepEqual(policyProblems(policy), ['is not a policy'], JSON.stringify(policy));
    assert.throws(() => runtimeFiles(withPolicies({ extension_pages: policy })), /content_security_policy "extension_pages" is not a policy/, JSON.stringify(policy));
  }
  // Only the policy of the extension's own pages: no other policy beside it, and nothing in its place.
  assert.throws(() => runtimeFiles(withPolicies({ extension_pages: POLICY, sandbox: "sandbox allow-scripts; script-src 'self'" })), /content_security_policy "sandbox" is not known to the packager/);
  for (const policies of [POLICY, null, 42, [], [POLICY], {}, { sandbox: 'sandbox allow-scripts' }]) {
    assert.throws(() => runtimeFiles(withPolicies(policies)), /manifest\.json: "content_security_policy" does not hold "extension_pages"/, JSON.stringify(policies));
  }
});

test('refuses a manifest that declares no content security policy', () => {
  const { content_security_policy: declared, ...without } = JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  // The repository's manifest declares one, and is taken with it.
  assert.deepEqual(runtimeFiles({ ...without, content_security_policy: declared }), RUNTIME);
  const refusal = { message: 'Cannot package:\nmanifest.json: has no "content_security_policy", so Chrome\'s default would apply, which lets a page load from outside the package' };
  assert.equal('content_security_policy' in without, false);
  assert.throws(() => runtimeFiles(without), refusal);
  assert.throws(() => runtimeFiles({ ...without, content_security_policy: undefined }), refusal);
  // It is one problem among the others, not the only one named.
  assert.throws(() => runtimeFiles({ ...without, options_page: 'options.html' }),
    { message: `Cannot package:\nmanifest.json: "options_page" is not known to the packager\n${refusal.message.split('\n')[1]}` });
});

test('writes nothing when the manifest\'s content security policy is refused', () => withTemp(dir => {
  const repo = fixture(dir);
  const manifest = JSON.parse(readFileSync(path.join(repo, 'manifest.json'), 'utf8'));
  const withPolicy = policy => {
    write(repo, 'manifest.json', `${JSON.stringify({ ...manifest, content_security_policy: { extension_pages: policy } }, null, 2)}\n`);
    touch(repo, 'manifest.json', SOURCES_AT);
  };
  withPolicy("default-src 'none'; script-src 'self' https://cdn.example.com");
  assert.throws(() => packageExtension({ dir: repo, outDir: path.join(dir, 'out') }),
    { message: 'Cannot package:\nmanifest.json: content_security_policy "extension_pages" allows https://cdn.example.com in script-src, which is not \'self\' or \'none\'' });
  assert.equal(existsSync(path.join(dir, 'out')), false, 'nothing written');
  // A manifest with no policy at all is refused the same way.
  const { content_security_policy: declared, ...without } = manifest;
  assert.deepEqual(Object.keys(declared), ['extension_pages']);
  write(repo, 'manifest.json', `${JSON.stringify(without, null, 2)}\n`);
  touch(repo, 'manifest.json', SOURCES_AT);
  assert.throws(() => packageExtension({ dir: repo, outDir: path.join(dir, 'out') }),
    { message: 'Cannot package:\nmanifest.json: has no "content_security_policy", so Chrome\'s default would apply, which lets a page load from outside the package' });
  assert.equal(existsSync(path.join(dir, 'out')), false, 'nothing written');
  withPolicy("default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self'");
  assert.doesNotThrow(() => packageExtension({ dir: repo, outDir: path.join(dir, 'out') }));
}));

test('refuses a version mismatch, and a bundle or a results page that is a link', () => withTemp(dir => {
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

  rmSync(path.join(repo, 'dist', 'content.js'));
  write(repo, 'dist/content.js', '// content bundle\n(() => {})();\n');
  touch(repo, 'dist/content.js', BUILT_AT);
  write(dir, 'elsewhere.html', PAGE);
  rmSync(path.join(repo, 'results.html'));
  symlinkSync(path.join(dir, 'elsewhere.html'), path.join(repo, 'results.html'));
  assert.throws(() => packageExtension({ dir: repo, outDir: path.join(dir, 'out') }), /results\.html is not a regular file/);
  assert.equal(existsSync(path.join(dir, 'out')), false, 'nothing written');
}));

test('the repository\'s package.json and manifest.json carry the same version', () => {
  const [pkg, manifest] = ['package.json', 'manifest.json'].map(name => JSON.parse(readFileSync(path.join(ROOT, name), 'utf8')));
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.version, manifest.version);
});

test('the repository\'s manifest declares a content security policy, and one the packager takes', () => {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.deepEqual(Object.keys(manifest.content_security_policy), ['extension_pages']);
  assert.deepEqual(policyProblems(manifest.content_security_policy.extension_pages), []);
});

test('the repository\'s results page loads only packaged files, its own stylesheets and bundle among them',
  { skip: !existsSync(path.join(ROOT, 'results.html')) && 'results.html is not in this checkout' }, () => {
    const read = name => readFileSync(path.join(ROOT, name), 'utf8');
    assert.deepEqual(pageProblems(read('results.html'), Object.fromEntries(PAGE_SHEETS.map(name => [name, read(name)])), runtimeFiles(JSON.parse(read('manifest.json')))), []);
  });

/** What a script makes a file with, starts a download by, or sends its page away with, each as it is written in a
 * script. A result is shown on the results page and nowhere else: none of this is in what Chrome loads. */
const MAKES_A_FILE = [
  ['makes an address for a blob', /\bcreateObjectURL\b/],
  ['makes a blob or a file', /\bnew\s+(?:Blob|File)\b|\bBlob\s*\(/],
  ['holds a link that saves', /\.download\b|["'`]download["'`]|\bdownload\s*=/],
  ['asks for a place to save in', /\bshow(?:Save|Open)FilePicker\b|\bshowDirectoryPicker\b|\bFileSystem[A-Z]\w*|\bmsSave(?:OrOpen)?Blob\b|\bsaveAs\b/],
  ['uses Chrome\'s downloads', /\bchrome\s*\.\s*downloads\b/],
  ['sends the page to another address', /\blocation\s*\.\s*(?:href\s*=(?!=)|assign\s*\(|replace\s*\()|\blocation\s*=(?!=)|\bwindow\s*\.\s*open\s*\(/],
  ['holds a file as an address', /\bdata:(?:text|application)\//],
  ['names a file\'s type', /\btext\/csv\b|\bapplication\/(?:zip|octet-stream)\b/],
  ['writes a zip', /\b(?:0x0403_?4b50|67324752|0x0201_?4b50|33639248|0x0605_?4b50|101010256)\b/i],
];
/** What a script's text holds of that: each kind, with the text that shows it. */
const fileMaking = text => MAKES_A_FILE.flatMap(([what, pattern]) => (pattern.test(text) ? [`${what}: ${text.match(pattern)[0]}`] : []));
/** The bundles Chrome loads, by the repository's manifest and results page, and why they cannot be read as built, if so. */
const BUILT = runtimeFiles(JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'))).filter(name => name.startsWith('dist/'));
const NOT_BUILT = staleBundles(ROOT, BUILT);

test('the repository\'s built bundles make no file, start no download and send their page nowhere',
  { skip: NOT_BUILT.length > 0 && `the bundles are not built from the sources as they are (${NOT_BUILT.join('; ')}): npm run build makes them` }, () => {
    assert.deepEqual(BUILT, BUNDLES);
    assert.deepEqual(BUILT.map(name => [name, fileMaking(readFileSync(path.join(ROOT, name), 'utf8'))]), BUILT.map(name => [name, []]));
    // The check finds each kind where a script has it, as the page's own script had while it offered a result for download.
    const offered = 'const url = URL.createObjectURL(new Blob([data], { type: "application/zip" })); link.href = url; link.download = name; view.setUint32(0, 67324752, true);';
    assert.deepEqual(fileMaking(offered).map(found => found.replace(/: .*/, '')),
      ['makes an address for a blob', 'makes a blob or a file', 'holds a link that saves', 'names a file\'s type', 'writes a zip']);
    assert.deepEqual(['showSaveFilePicker()', 'chrome.downloads.download({})', 'location.href = to', 'location.assign(to)', 'window.open(to)', 'a.href = "data:text/csv,a"'].map(text => fileMaking(text).length > 0),
      [true, true, true, true, true, true]);
    // What the bundles do hold of the kind is none of it: an address read, a text put in another's place, a name compared.
    assert.deepEqual(['new URL(path, location.origin).href', 'text.replace(/a/g, "b")', 'if (location.href === other) return;', 'const downloads = 0;'].map(fileMaking), [[], [], [], []]);
  });
