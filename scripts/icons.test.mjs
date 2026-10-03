import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { encodePng, ICON_SIZES, ICONS_DIR, renderIcon, writeIcons } from './icons.mjs';

const root = path.resolve(ICONS_DIR, '..');

/** Independent PNG reader: signature, chunk CRCs, header, and the inflated rows with their filter bytes removed. */
function readPng(buffer) {
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
