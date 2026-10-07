import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { decodePng, encodePng, ICON_SIZES, ICONS_DIR, readSource, renderIcon, scaleDown, SOURCE, visibleSquare, writeIcons } from './icons.mjs';

const root = path.resolve(ICONS_DIR, '..');
/** The owner's logo, read once, by the first test that needs it. */
let ownersLogo;
const source = () => (ownersLogo ??= readSource());
const CLEAR = [0, 0, 0, 0];

/** The chunks of a PNG file, read apart from the script: the signature, and each chunk's type, data and CRC. */
function chunksOf(buffer) {
  assert.deepEqual([...buffer.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG signature');
  const chunks = [];
  for (let at = 8; at < buffer.length;) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString('latin1', at + 4, at + 8);
    const data = buffer.subarray(at + 8, at + 8 + length);
    assert.equal(buffer.readUInt32BE(at + 8 + length), zlib.crc32(buffer.subarray(at + 4, at + 8 + length)), `${type} CRC`);
    chunks.push({ type, data });
    at += 12 + length;
  }
  return chunks;
}

/** Independent PNG reader of what the script writes: three chunks, the header, and the inflated rows, each byte of which
 * is what was left when the byte above it was taken away (filter type 2, up). */
function readPng(buffer) {
  const chunks = chunksOf(buffer);
  assert.deepEqual(chunks.map(chunk => chunk.type), ['IHDR', 'IDAT', 'IEND']);
  const header = chunks[0].data;
  const [width, height] = [header.readUInt32BE(0), header.readUInt32BE(4)];
  assert.deepEqual([...header.subarray(8)], [8, 6, 0, 0, 0], '8-bit RGBA, not interlaced');
  const raw = zlib.inflateSync(chunks[1].data);
  assert.equal(raw.length, height * (width * 4 + 1));
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const start = y * (width * 4 + 1);
    assert.equal(raw[start], 2, `row ${y} filter`);
    for (let x = 0; x < width * 4; x++) pixels[y * width * 4 + x] = (raw[start + 1 + x] + (y > 0 ? pixels[(y - 1) * width * 4 + x] : 0)) & 255;
  }
  return { width, height, pixels };
}

/** A PNG file built apart from the script: the given chunks, each [type, data], with their lengths and CRCs. */
function fileOf(...chunks) {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks.map(([type, data = Buffer.alloc(0)]) => {
    const [length, crc, body] = [Buffer.alloc(4), Buffer.alloc(4), Buffer.concat([Buffer.from(type, 'latin1'), data])];
    length.writeUInt32BE(data.length);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
  })]);
}
/** The header chunk of a `width` × `height` image of the given bit depth, colour type and interlace method. */
function ihdr(width, height, depth = 8, colour = 6, interlace = 0) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data.set([depth, colour, 0, 0, interlace], 8);
  return ['IHDR', data];
}
/** The bytes (i² + 18i) mod 256: pixels of no pattern that a row filter would favour. */
const mixed = length => Buffer.from(Array.from({ length }, (_, i) => (i * i + 18 * i) & 255));

/** An image whose pixel at `x`, `y` is `at(x, y)`: red, green, blue and alpha. */
function picture(width, height, at) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set(at(x, y), (y * width + x) * 4);
  return { width, height, pixels };
}
/** The pixels of a `size` × `size` icon as rows of [red, green, blue, alpha]. */
const rowsOf = (pixels, size) => Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => [...pixels.subarray((y * size + x) * 4, (y * size + x + 1) * 4)]));
/** The whole of a square image as the square `scaleDown` takes: its centre in half pixels, and its side. */
const whole = image => ({ x: image.width, y: image.height, side: image.width });

function withTemp(run) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cardigan-icons-'));
  try { return run(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('the committed icons are the ones the script makes from the source, at every size the manifest lists', () => {
  const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const listed = Object.fromEntries(ICON_SIZES.map(size => [String(size), `icons/${size}.png`]));
  assert.deepEqual(manifest.icons, listed);
  assert.deepEqual(manifest.action.default_icon, listed);
  assert.equal(path.relative(root, SOURCE), path.join('icons', 'source.png'));
  for (const size of ICON_SIZES) {
    const png = readPng(readFileSync(path.join(ICONS_DIR, `${size}.png`)));
    assert.deepEqual([png.width, png.height], [size, size]);
    // Pixels, not bytes: nothing promises that every build of zlib packs the same pixels into the same bytes.
    assert.ok(png.pixels.equals(renderIcon(size, source())), `icons/${size}.png differs from what scripts/icons.mjs makes from icons/source.png; run npm run icons`);
  }
});

test('shows the logo on a transparent ground: clear corners, a solid middle, the same pixels on every run', () => {
  for (const size of ICON_SIZES) {
    const pixels = renderIcon(size, source());
    const alpha = (x, y) => pixels[(y * size + x) * 4 + 3];
    for (const [x, y] of [[0, 0], [size - 1, 0], [0, size - 1], [size - 1, size - 1]]) assert.equal(alpha(x, y), 0, `${size}: corner ${x}, ${y}`);
    // The logo's own alpha stops just short of 255.
    assert.ok(alpha(size >> 1, size >> 1) >= 250, `${size}: middle`);
    assert.ok(pixels.equals(renderIcon(size)), `${size}: repeatable`);
  }
});

test('writes a PNG file for each size, which reads back as the icon', () => withTemp(dir => {
  const files = writeIcons(dir, source());
  assert.deepEqual(files.map(file => path.basename(file)), ICON_SIZES.map(size => `${size}.png`));
  for (const [index, size] of ICON_SIZES.entries()) {
    const written = readFileSync(files[index]);
    assert.ok(written.equals(encodePng(size, size, renderIcon(size, source()))));
    assert.ok(readPng(written).pixels.equals(renderIcon(size, source())));
  }
}));

test('the reader reads what the writer writes, and so does the test\'s own reader', () => {
  // Not square, so that a width taken for a height would show.
  const image = { width: 8, height: 9, pixels: mixed(8 * 9 * 4) };
  const png = encodePng(image.width, image.height, image.pixels);
  assert.deepEqual(decodePng(png), image);
  assert.deepEqual(readPng(png), image);
  assert.ok(png.equals(encodePng(image.width, image.height, image.pixels)), 'the same pixels, the same bytes');
});

// A PNG file made by hand, apart from the script, and checked with another PNG reader (Pillow) when it was made: 4 × 7 pixels,
// the bytes of `mixed`. Its rows are filtered in each of PNG's five ways (average, none, sub, up, average, Paeth, Paeth), so
// average meets a first row and odd sums, which it halves downwards, and Paeth picks each of its three neighbours and meets
// both ties in which the order of its choices decides. The packed rows are cut into three IDAT chunks, with a text chunk
// before them and a private chunk after.
const FIVE_FILTERS = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAHCAYAAAAvZezQAAAAFHRFWHRDb21tZW50AGEgdGVzdCBpbWFnZSkUtVQAAAABSURBVHh25oTmAAAAJ0lEQVTaY2YQ1rCPyKqZsGTX'
  + 'hRcMUlsuMCgEd+z/YVyw/oNxxX6O4AXvGR3bqc/tAAAATElEQVQmv7CPSMgoqGjomDBjwYoNTAoOCQ0LDjxggNHMAataHtQILLE4k1DSMWfDkQgWiMyLDwoOHA0LFDoYwAIV'
  + 'CQ9AZjTMWPBgAwBRRjWuEf35TAAAAANwclZ0AQIDzh33MAAAAABJRU5ErkJggg==';

test('reads rows filtered in each of the five ways, from data cut into several chunks among other chunks', () => {
  const file = Buffer.from(FIVE_FILTERS, 'base64');
  const chunks = chunksOf(file);
  assert.deepEqual(chunks.map(chunk => chunk.type), ['IHDR', 'tEXt', 'IDAT', 'IDAT', 'IDAT', 'prVt', 'IEND']);
  const rows = zlib.inflateSync(Buffer.concat(chunks.filter(chunk => chunk.type === 'IDAT').map(chunk => chunk.data)));
  assert.deepEqual([...rows].filter((_, at) => at % 17 === 0), [3, 0, 1, 2, 3, 4, 4], 'the filter of each row');
  assert.deepEqual(decodePng(file), { width: 4, height: 7, pixels: mixed(4 * 7 * 4) });
  // Rows without a filter, in a file the test builds.
  const plain = fileOf(ihdr(2, 1), ['IDAT', zlib.deflateSync(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8]))], ['IEND']);
  assert.deepEqual(decodePng(plain), { width: 2, height: 1, pixels: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]) });
});

test('refuses a source that is not an 8-bit RGBA PNG, not interlaced, in plain words', () => withTemp(dir => {
  const kinds = [[8, 2, 0, '8-bit RGB'], [16, 6, 0, '16-bit RGBA'], [8, 3, 0, '8-bit palette'], [8, 0, 0, '8-bit greyscale'], [16, 4, 0, '16-bit greyscale with alpha'],
    [8, 6, 1, '8-bit RGBA, interlaced'], [8, 9, 0, '8-bit colour type 9']];
  for (const [depth, colour, interlace, said] of kinds) {
    assert.throws(() => decodePng(fileOf(ihdr(1, 1, depth, colour, interlace), ['IEND']), 'logo.png'),
      { message: `logo.png must be an 8-bit RGBA PNG that is not interlaced: it is ${said}` });
  }
  assert.throws(() => decodePng(Buffer.from('GIF89a: another kind of picture'), 'logo.png'), { message: 'logo.png is not a PNG file' });
  assert.throws(() => decodePng(Buffer.alloc(0)), { message: 'The image is not a PNG file' });
  // A file that is a PNG of the right kind, but not a whole one.
  const pixel = Buffer.from([0, 10, 20, 30, 255]);
  const good = fileOf(ihdr(1, 1), ['IDAT', zlib.deflateSync(pixel)], ['IEND']);
  assert.deepEqual(decodePng(good), { width: 1, height: 1, pixels: pixel.subarray(1) });
  for (const cut of [1, 4, 12, 20, good.length - 8]) assert.throws(() => decodePng(good.subarray(0, good.length - cut)), { message: 'The image is cut short' }, `cut by ${cut}`);
  const flipped = Buffer.from(good);
  flipped[45] ^= 1; // a byte of the packed pixel
  assert.throws(() => decodePng(flipped), { message: 'The image is damaged: its IDAT chunk fails its check' });
  assert.throws(() => decodePng(fileOf(['IEND'])), { message: 'The image is damaged: it has no header' });
  assert.throws(() => decodePng(fileOf(ihdr(1, 1), ['IDAT', Buffer.from('not packed')], ['IEND'])), /^Error: The image is damaged: \S/);
  assert.throws(() => decodePng(fileOf(ihdr(2, 2), ['IDAT', zlib.deflateSync(pixel)], ['IEND'])), { message: 'The image is damaged: it holds 5 bytes of pixels, not 18' });
  assert.throws(() => decodePng(fileOf(ihdr(1, 1), ['IDAT', zlib.deflateSync(Buffer.from([5, 10, 20, 30, 255]))], ['IEND'])), { message: 'The image is damaged: row 0 has filter type 5' });
  // The source is named by its place from the repository's root, when it is refused and when it is not there.
  const file = path.join(dir, 'logo.png');
  assert.throws(() => readSource(file), { message: `${path.relative(root, file)} is missing` });
  writeFileSync(file, good);
  assert.deepEqual(readSource(file), { width: 1, height: 1, pixels: pixel.subarray(1) });
  writeFileSync(file, fileOf(ihdr(1, 1, 8, 2), ['IEND']));
  assert.throws(() => readSource(file), { message: `${path.relative(root, file)} must be an 8-bit RGBA PNG that is not interlaced: it is 8-bit RGB` });
}));

test('scales a solid square to a solid square, and an image to itself at its own size', () => {
  for (const colour of [[200, 100, 50, 255], [200, 100, 50, 128], [0, 255, 1, 8]]) {
    const square = picture(12, 12, () => colour);
    // Whole source pixels to an icon pixel (12, 4, 1), and parts of them (8, 5).
    for (const size of [12, 8, 5, 4, 1]) assert.deepEqual(rowsOf(scaleDown(square, whole(square), size), size).flat(), Array(size * size).fill(colour), `${colour} to ${size}`);
  }
  const image = picture(6, 6, (x, y) => ((x + y) % 4 === 0 ? CLEAR : [x * 50, y * 50, 255 - x * y, 8 + x * 40 + y * 7]));
  assert.ok(scaleDown(image, whole(image), 6).equals(image.pixels));
});

test('keeps the colour of an edge: the transparent ground, whatever is hidden in it, lends it none', () => {
  const logo = [20, 40, 200];
  // Three columns of the logo's colour, then one of transparent ground with white hidden in it.
  const edge = picture(4, 4, x => (x < 3 ? [...logo, 255] : [255, 255, 255, 0]));
  // Two columns to an icon pixel: the right one is half logo and half ground, so the logo's colour at half the alpha.
  assert.deepEqual(rowsOf(scaleDown(edge, whole(edge), 2), 2), [[[...logo, 255], [...logo, 128]], [[...logo, 255], [...logo, 128]]]);
  assert.deepEqual(rowsOf(scaleDown(edge, whole(edge), 1), 1), [[[...logo, 191]]]);
  // A soft edge of the logo's own: half-transparent pixels of its colour stay that colour.
  const soft = picture(2, 2, x => [...logo, x === 0 ? 255 : 128]);
  assert.deepEqual(rowsOf(scaleDown(soft, whole(soft), 1), 1), [[[...logo, 192]]]);
  // Where two colours meet, each counts by its alpha: 255 parts of red to 85 of blue, at the alpha between the two.
  const meeting = picture(2, 2, x => (x === 0 ? [255, 0, 0, 255] : [0, 0, 255, 85]));
  assert.deepEqual(rowsOf(scaleDown(meeting, whole(meeting), 1), 1), [[[191, 0, 64, 170]]]);
});

test('cuts the square around what is visible, centred on it even between two pixels, with a hair of margin', () => {
  // A block three pixels wide and six tall, off centre in a transparent image.
  const colour = [90, 60, 200];
  const block = (x, y) => x >= 2 && x <= 4 && y >= 1 && y <= 6;
  const image = picture(10, 10, (x, y) => (block(x, y) ? [...colour, 255] : CLEAR));
  // Six pixels and one of margin on each side, centred on the block's centre at 3.5, 4: so it starts half a pixel left of
  // the image.
  assert.deepEqual(visibleSquare(image), { x: 7, y: 8, side: 8 });
  const alphas = size => rowsOf(renderIcon(size, image), size).map(row => row.map(pixel => pixel[3]));
  // At the square's own size the block covers half of a column on each side, and the margin is a clear row above and below.
  const across = [0, 0, 128, 255, 255, 128, 0, 0];
  assert.deepEqual(alphas(8), [Array(8).fill(0), across, across, across, across, across, across, Array(8).fill(0)]);
  // At half the size: three quarters of each middle column, and half of the top and bottom rows.
  assert.deepEqual(alphas(4), [[0, 96, 96, 0], [0, 191, 191, 0], [0, 191, 191, 0], [0, 96, 96, 0]]);
  for (const size of [8, 4, 3]) {
    for (const row of rowsOf(renderIcon(size, image), size)) {
      assert.deepEqual(row.map(pixel => pixel[3]), row.map(pixel => pixel[3]).reverse(), `${size}: the same left and right`);
      for (const pixel of row) assert.deepEqual(pixel.slice(0, 3), pixel[3] ? colour : [0, 0, 0]);
    }
  }
  // Wherever the block lies, the icon is the same: the square may reach past any side of the image, where there is nothing.
  for (const [left, top] of [[0, 0], [7, 4], [0, 4], [7, 0]]) {
    const moved = picture(10, 10, (x, y) => (block(x - left + 2, y - top + 1) ? [...colour, 255] : CLEAR));
    for (const size of [8, 4, 3]) assert.ok(renderIcon(size, moved).equals(renderIcon(size, image)), `block at ${left}, ${top}, to ${size}`);
  }
  // The margin is one part in 64 of the longer side, rounded up, whichever side is longer.
  assert.deepEqual(visibleSquare(picture(200, 3, (x, y) => (y === 1 && x < 129 ? [...colour, 255] : CLEAR))), { x: 129, y: 3, side: 129 + 2 * 3 });
  assert.deepEqual(visibleSquare(picture(3, 70, (x, y) => (x === 2 && y >= 6 ? [...colour, 255] : CLEAR))), { x: 5, y: 76, side: 64 + 2 * 1 });
});

test('leaves out what is too faint to see: it neither widens the square nor shows in the icon', () => {
  const block = (x, y) => x >= 2 && x <= 4 && y >= 1 && y <= 6;
  // A speck inside the square and one outside it.
  const speck = (x, y) => (x === 6 && y === 3) || (x === 9 && y === 9);
  const withSpecks = alpha => picture(10, 10, (x, y) => (block(x, y) ? [90, 60, 200, 255] : speck(x, y) ? [255, 255, 255, alpha] : CLEAR));
  const clean = withSpecks(0);
  for (const alpha of [1, 7]) {
    assert.deepEqual(visibleSquare(withSpecks(alpha)), { x: 7, y: 8, side: 8 }, `alpha ${alpha}`);
    for (const size of [8, 4]) assert.ok(renderIcon(size, withSpecks(alpha)).equals(renderIcon(size, clean)), `alpha ${alpha} at ${size}`);
  }
  // From 8 of 255 a pixel counts: the square reaches out to it.
  assert.deepEqual(visibleSquare(withSpecks(8)), { x: 12, y: 11, side: 11 });
  assert.throws(() => visibleSquare(picture(3, 3, () => [255, 255, 255, 7])), { message: 'Nothing in the image is visible' });
});
