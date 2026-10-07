import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { decodePng, encodePng, ICON_SIZES, ICONS_DIR, renderIcon, writeIcons } from './icons.mjs';

const root = path.resolve(ICONS_DIR, '..');

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

/** Independent PNG reader of what the script writes: three chunks, the header, and the inflated rows with their filter bytes removed. */
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
    assert.equal(raw[start], 0, `row ${y} filter`);
    raw.copy(pixels, y * width * 4, start + 1, start + 1 + width * 4);
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

test('the committed icons are the ones the script draws, at every size the manifest lists', () => {
  const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.icons, Object.fromEntries(ICON_SIZES.map(size => [String(size), `icons/${size}.png`])));
  for (const size of ICON_SIZES) {
    const png = readPng(readFileSync(path.join(ICONS_DIR, `${size}.png`)));
    assert.deepEqual([png.width, png.height], [size, size]);
    // Pixels, not bytes: another zlib build may compress the same pixels differently.
    assert.ok(png.pixels.equals(renderIcon(size)), `icons/${size}.png differs from what scripts/icons.mjs draws; run npm run icons`);
  }
});

test('draws a transparent outside corner, an opaque middle, and the same pixels on every run', () => {
  for (const size of ICON_SIZES) {
    const pixels = renderIcon(size);
    const alpha = (x, y) => pixels[(y * size + x) * 4 + 3];
    assert.equal(alpha(0, 0), 0, `${size}: corner`);
    assert.equal(alpha(size >> 1, size >> 1), 255, `${size}: middle`);
    assert.ok(pixels.equals(renderIcon(size)), `${size}: repeatable`);
  }
});

test('writes PNG files that decode to the drawn pixels', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cardigan-icons-'));
  try {
    const files = writeIcons(dir);
    assert.deepEqual(files.map(file => path.basename(file)), ICON_SIZES.map(size => `${size}.png`));
    for (const [index, size] of ICON_SIZES.entries()) {
      const written = readFileSync(files[index]);
      assert.ok(written.equals(encodePng(size, size, renderIcon(size))));
      assert.ok(readPng(written).pixels.equals(renderIcon(size)));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

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

test('refuses a file that is not an 8-bit RGBA PNG, not interlaced, in plain words', () => {
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
});
