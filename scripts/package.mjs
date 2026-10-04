// Packages the built extension as release/cardigan-<version>.zip and prints its SHA-256.
// The zip holds only the files Chrome loads: manifest.json, the bundles it names under dist/, the icons it names under
// icons/, and the results page with its stylesheet and its bundle; a page that loads any other file is refused, and so is a
// content security policy that would let one in from outside the package. Entries are sorted, carry fixed timestamps and
// attributes and are stored uncompressed, so the same files give the same bytes on every run, machine and Node version.
// Offline: it never uploads or publishes anything.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Manifest keys the packager understands. A key that could name another file (web_accessible_resources, options_page,
 * side_panel…) fails packaging until the packager learns it, so a runtime file can never be left out silently. A permission
 * key fails it too: Cardigan asks for none. */
const KNOWN_KEYS = new Set(['manifest_version', 'name', 'version', 'minimum_chrome_version', 'description', 'icons', 'action', 'background', 'content_scripts',
  'content_security_policy']);
const KNOWN_SCRIPT_KEYS = new Set(['matches', 'js', 'run_at', 'world', 'all_frames']);
/** The toolbar icon has a title and icons. A default_popup would name a page, and would take the click from the service worker. */
const KNOWN_ACTION_KEYS = new Set(['default_title', 'default_icon']);
const KNOWN_BACKGROUND_KEYS = new Set(['service_worker']);
/** The one policy the packager knows: that of the extension's own pages and its service worker. A sandbox policy would
 * come with sandboxed pages, which the manifest would have to name. */
const KNOWN_POLICY_KEYS = new Set(['extension_pages']);
/** What a policy may let in: the extension's own files, or nothing. */
const PACKAGED_SOURCES = new Set(["'self'", "'none'"]);
/** A style written in the page runs no code, and what it loads is held to the same sources: these directives may allow it. */
const INLINE_STYLE_DIRECTIVES = new Set(['style-src', 'style-src-elem', 'style-src-attr']);
/** The only places a file the manifest names may come from: built bundles and icons. Never src, tests, docs or node_modules. */
const RUNTIME_PATH = /^(?:dist\/[A-Za-z0-9][A-Za-z0-9._-]*\.js|icons\/[A-Za-z0-9][A-Za-z0-9._-]*\.png)$/;
/** The results page, its stylesheet and its bundle. The manifest names none of them: the service worker opens the page by
 * name (RESULTS_PAGE in src/protocol.ts), and the page loads the other two. */
const PAGE_FILES = ['results.html', 'results.css', 'dist/results.js'];
const [PAGE, PAGE_STYLES, PAGE_BUNDLE] = PAGE_FILES;
/** A start tag with its attributes, and one attribute with its value: in either quotes, or bare. */
const TAG = /<([a-z][a-z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
const ATTRIBUTE = /([^\s"'=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
/** url(…) and @import "…", wherever styles are written: the stylesheet, a <style> block or a style attribute. A longer name
 * that ends in url, such as createObjectURL(…), is not one. */
const STYLE_LOAD = /(?<![\w-])url\(\s*(?:"([^"]*)"|'([^']*)'|([^"'()\s]*))\s*\)|@import\s+(?:"([^"]*)"|'([^']*)')/gi;
/** Inputs of the bundles: if any is newer than a bundle, the bundle is stale. Tests are not bundled. */
const BUILD_INPUTS = ['manifest.json', 'package-lock.json', 'scripts/build.mjs'];
const NOT_BUNDLED = /\.test(?:-support)?\.ts$/;

// Fixed zip metadata: 1980-01-01 00:00 (the DOS epoch), Unix "made by", regular file 0644, UTF-8 names, stored.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const MADE_BY = (3 << 8) | 20;
const VERSION_NEEDED = 20;
const UTF8 = 0x0800;
const STORED = 0;
const EXTERNAL_ATTRS = (0o100644 << 16) >>> 0;

const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const readJson = (dir, name) => JSON.parse(readFileSync(path.join(dir, name), 'utf8'));

/** What keeps a content security policy out of a package. Whatever the policy lets a page or the service worker load must
 * be in the package: every source is 'self' or 'none', and default-src is there, so that what the policy does not list is
 * refused too. That leaves no remote source (a scheme, a host or a wildcard), no 'unsafe-eval' and no inline script. The
 * directives for styles may allow 'unsafe-inline'. */
export function policyProblems(policy) {
  if (typeof policy !== 'string' || policy.trim() === '') return ['is not a policy'];
  const directives = policy.split(';').map(part => part.trim().split(/\s+/)).filter(([name]) => name !== '')
    .map(([name, ...sources]) => [name.toLowerCase(), sources]);
  const problems = directives.flatMap(([name, sources]) => sources
    .filter(source => !PACKAGED_SOURCES.has(source.toLowerCase()) && !(source.toLowerCase() === "'unsafe-inline'" && INLINE_STYLE_DIRECTIVES.has(name)))
    .map(source => `allows ${source} in ${name}, which is not 'self' or 'none'`));
  if (!directives.some(([name]) => name === 'default-src')) problems.push('has no default-src, so what it does not list could come from anywhere');
  return problems;
}

/** The files Chrome loads, as sorted posix paths: the manifest itself, the files it names and the results page's files. */
export function runtimeFiles(manifest) {
  const problems = [];
  const checkKeys = (section, known, where) => {
    for (const key of Object.keys(section)) if (!known.has(key)) problems.push(`manifest.json: ${where}"${key}" is not known to the packager`);
  };
  const scripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
  const [action, background] = [manifest.action ?? {}, manifest.background ?? {}];
  checkKeys(manifest, KNOWN_KEYS, '');
  for (const script of scripts) checkKeys(script, KNOWN_SCRIPT_KEYS, 'content_scripts ');
  checkKeys(action, KNOWN_ACTION_KEYS, 'action ');
  checkKeys(background, KNOWN_BACKGROUND_KEYS, 'background ');
  if ('content_security_policy' in manifest) {
    const policies = manifest.content_security_policy;
    if (!policies || typeof policies !== 'object' || Array.isArray(policies) || !('extension_pages' in policies)) {
      problems.push('manifest.json: "content_security_policy" does not hold "extension_pages"');
    } else {
      checkKeys(policies, KNOWN_POLICY_KEYS, 'content_security_policy ');
      for (const problem of policyProblems(policies.extension_pages)) problems.push(`manifest.json: content_security_policy "extension_pages" ${problem}`);
    }
  }
  const named = [
    ...scripts.flatMap(script => script.js ?? []),
    ...Object.values(manifest.icons ?? {}),
    // The toolbar icon: one file, or one per size.
    ...(typeof action.default_icon === 'string' ? [action.default_icon] : Object.values(action.default_icon ?? {})),
    ...(background.service_worker === undefined ? [] : [background.service_worker]),
  ];
  for (const file of named) {
    if (typeof file !== 'string' || !RUNTIME_PATH.test(file)) problems.push(`manifest.json: ${JSON.stringify(file)} is not a dist/*.js bundle or an icons/*.png icon`);
  }
  if (problems.length) throw new Error(`Cannot package:\n${problems.join('\n')}`);
  return [...new Set(['manifest.json', ...named, ...PAGE_FILES])].sort(byName);
}

function sourceFiles(dir) {
  const found = [];
  const visit = relative => {
    const full = path.join(dir, relative);
    if (!existsSync(full)) return;
    for (const entry of readdirSync(full, { withFileTypes: true })) {
      const rel = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(rel);
      else if (entry.name.endsWith('.ts') && !NOT_BUNDLED.test(entry.name)) found.push(rel);
    }
  };
  visit('src');
  return [...BUILD_INPUTS.filter(name => existsSync(path.join(dir, name))), ...found];
}

/** Bundles that are missing, or older than a source they are built from. */
export function staleBundles(dir, files) {
  const sources = sourceFiles(dir).map(name => ({ name, time: lstatSync(path.join(dir, name)).mtimeMs }));
  const newest = sources.reduce((latest, source) => (source.time > latest.time ? source : latest), { name: '', time: -Infinity });
  return files.filter(name => name.startsWith('dist/')).flatMap(name => {
    const full = path.join(dir, name);
    if (!existsSync(full)) return [`${name} is missing`];
    return lstatSync(full).mtimeMs < newest.time ? [`${name} is older than ${newest.name}`] : [];
  });
}

/** Whether an address makes Chrome load a file: not when it is empty, a place in the page itself (#…) or inline data. */
const loadsFile = address => address !== '' && !/^(?:#|data:)/i.test(address);

/** What a page's markup loads: every src, and the href of every <link>. A link the user follows (<a href>) loads nothing. */
function markupLoads(html) {
  const found = [];
  for (const [, tag, attributes] of html.matchAll(TAG)) {
    for (const [, name, double, single, bare] of attributes.matchAll(ATTRIBUTE)) {
      if (name.toLowerCase() === 'src' || (name.toLowerCase() === 'href' && tag.toLowerCase() === 'link')) found.push(double ?? single ?? bare);
    }
  }
  return found.filter(loadsFile);
}

/** What styles load: every url() and @import. */
function styleLoads(styles) {
  return [...styles.matchAll(STYLE_LOAD)].map(match => match.slice(1).find(address => address !== undefined)).filter(loadsFile);
}

/** What keeps the results page out of a package, given its text, its stylesheet's and the packaged `files`. Every file the
 * two load must be packaged, under the name it is packaged by, so that nothing the page needs is left out and nothing comes
 * from the network. And the page must load its own stylesheet and bundle, so that neither is packaged unused. */
export function pageProblems(page, styles, files) {
  const loads = { [PAGE]: [...markupLoads(page), ...styleLoads(page)], [PAGE_STYLES]: styleLoads(styles) };
  return [
    ...Object.entries(loads).flatMap(([name, loaded]) => [...new Set(loaded)].filter(file => !files.includes(file))
      .map(file => `${name} loads ${JSON.stringify(file)}, which is not packaged`)),
    ...[PAGE_STYLES, PAGE_BUNDLE].filter(file => !loads[PAGE].includes(file)).map(file => `${PAGE} does not load ${file}`),
  ];
}

/** A zip of `[{ name, data }]` in the given order: stored entries with fixed timestamps and attributes. */
export function createZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(VERSION_NEEDED, 4);
    local.writeUInt16LE(UTF8, 6);
    local.writeUInt16LE(STORED, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(MADE_BY, 4);
    central.writeUInt16LE(VERSION_NEEDED, 6);
    central.writeUInt16LE(UTF8, 8);
    central.writeUInt16LE(STORED, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    // Extra field, comment, disk number and internal attributes stay zero.
    central.writeUInt32LE(EXTERNAL_ATTRS, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
    if (offset > 0xffffffff) throw new Error('The package exceeds the 4 GiB zip limit');
  }
  if (entries.length > 0xffff) throw new Error('Too many files for a zip without Zip64');
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** Checks the build in `dir` and writes `cardigan-<version>.zip` to `outDir`. Nothing is written when a check fails. */
export function packageExtension({ dir = ROOT, outDir = path.join(dir, 'release') } = {}) {
  const manifest = readJson(dir, 'manifest.json');
  const { version } = readJson(dir, 'package.json');
  if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Cannot package: manifest.json has no x.y.z version');
  if (version !== manifest.version) throw new Error(`Cannot package: package.json is version ${version} but manifest.json is ${manifest.version}`);
  const files = runtimeFiles(manifest);
  const stale = staleBundles(dir, files);
  if (stale.length) throw new Error(`Cannot package: ${stale.join('; ')}. Run npm run build first (npm run package does this).`);
  const entries = files.map(name => {
    const full = path.join(dir, ...name.split('/'));
    if (!existsSync(full)) throw new Error(`Cannot package: ${name} is missing`);
    if (!lstatSync(full).isFile()) throw new Error(`Cannot package: ${name} is not a regular file`);
    return { name, data: readFileSync(full) };
  });
  const text = name => entries.find(entry => entry.name === name).data.toString('utf8');
  const problems = pageProblems(text(PAGE), text(PAGE_STYLES), files);
  if (problems.length) throw new Error(`Cannot package:\n${problems.join('\n')}`);
  const zip = createZip(entries);
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `cardigan-${manifest.version}.zip`);
  writeFileSync(file, zip);
  return { file, files, bytes: zip.length, sha256: createHash('sha256').update(zip).digest('hex') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { file, files, bytes, sha256 } = packageExtension();
    console.log(`Packaged ${path.relative(ROOT, file)} (${files.length} files, ${bytes} bytes): ${files.join(', ')}`);
    console.log(`SHA-256 ${sha256}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
