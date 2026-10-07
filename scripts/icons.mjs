// Makes the extension's icons (icons/16.png, 32.png, 48.png, 128.png) from the owner's logo, icons/source.png. The logo is
// cut to the square around what is visible in it, with a hair of margin, and scaled down to each size: an icon pixel is
// the average of the source pixels under it, each weighted by the area it covers and by its alpha, so the transparent
// ground lends the logo's edge no colour. Whole numbers throughout, so the same source gives the same pixels on every
// machine. Node built-ins only: node:zlib reads and writes the PNG data. The source is not packaged: the packager takes
// only the icons the manifest names.
// Run `npm run icons` to make them again.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ICONS_DIR = path.join(root, 'icons');
export const ICON_SIZES = [16, 32, 48, 128];
/** The owner's logo: an 8-bit RGBA PNG, not interlaced. */
export const SOURCE = path.join(ICONS_DIR, 'source.png');

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const COLOUR_TYPES = { 0: 'greyscale', 2: 'RGB', 3: 'palette', 4: 'greyscale with alpha', 6: 'RGBA' };
/** The least alpha, of 255, that counts as visible. An image can hold specks too faint to see around the logo: they are
 * left out, so they neither widen the square nor dot the transparent ground. */
const VISIBLE = 8;
/** The margin on each side of the logo: one part in this many of its longer side, so that nothing touches the edge. */
const MARGIN_SHARE = 64;

/** The Paeth predictor of PNG's filter type 4: whichever of left, up and up-left is nearest to left + up - up-left. */
function paeth(left, up, upLeft) {
  const [toLeft, toUp, toUpLeft] = [Math.abs(up - upLeft), Math.abs(left - upLeft), Math.abs(left + up - 2 * upLeft)];
  return toLeft <= toUp && toLeft <= toUpLeft ? left : toUp <= toUpLeft ? up : upLeft;
}

/** The size and the RGBA pixels, row by row, of an 8-bit RGBA PNG that is not interlaced: what `encodePng` writes, and what
 * the source must be. Any other file is refused, by `name`. */
export function decodePng(buffer, name = 'The image') {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error(`${name} is not a PNG file`);
  let header;
  const data = [];
  for (let at = 8, type; type !== 'IEND';) {
    // A chunk: four bytes of length, four of type, the data, and a check of the type and the data.
    const end = at + 12 <= buffer.length ? at + 8 + buffer.readUInt32BE(at) : Infinity;
    if (end + 4 > buffer.length) throw new Error(`${name} is cut short`);
    type = buffer.toString('latin1', at + 4, at + 8);
    if (buffer.readUInt32BE(end) !== zlib.crc32(buffer.subarray(at + 4, end))) throw new Error(`${name} is damaged: its ${type} chunk fails its check`);
    if (type === 'IHDR') header = buffer.subarray(at + 8, end);
    if (type === 'IDAT') data.push(buffer.subarray(at + 8, end));
    at = end + 4;
  }
  if (header?.length !== 13) throw new Error(`${name} is damaged: it has no header`);
  const [width, height] = [header.readUInt32BE(0), header.readUInt32BE(4)];
  const [depth, colour, , , interlace] = header.subarray(8);
  if (depth !== 8 || colour !== 6 || interlace !== 0) {
    throw new Error(`${name} must be an 8-bit RGBA PNG that is not interlaced: it is ${depth}-bit ${COLOUR_TYPES[colour] ?? `colour type ${colour}`}${interlace ? ', interlaced' : ''}`);
  }
  const stride = width * 4;
  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(data)); } catch (error) { throw new Error(`${name} is damaged: ${error.message}`); }
  if (raw.length !== height * (stride + 1)) throw new Error(`${name} is damaged: it holds ${raw.length} bytes of pixels, not ${height * (stride + 1)}`);
  // Each row starts with its filter type: what was taken from every byte before packing, to be added back.
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const [filter, from, to] = [raw[y * (stride + 1)], y * (stride + 1) + 1, y * stride];
    if (filter > 4) throw new Error(`${name} is damaged: row ${y} has filter type ${filter}`);
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? pixels[to + x - 4] : 0;
      const up = y > 0 ? pixels[to + x - stride] : 0;
      const upLeft = x >= 4 && y > 0 ? pixels[to + x - stride - 4] : 0;
      const predicted = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : paeth(left, up, upLeft);
      pixels[to + x] = (raw[from + x] + predicted) & 255;
    }
  }
  return { width, height, pixels };
}

/** The alpha of the pixel at byte `at`, or 0 when it is too faint to see. */
const alphaAt = (pixels, at) => (pixels[at + 3] < VISIBLE ? 0 : pixels[at + 3]);

/** The square to cut from an image so that what is visible in it is as large as a square allows: the smallest square
 * around its visible pixels, centred on them, with a hair of margin on every side. `x` and `y` are its centre in half
 * pixels, a whole number even when the centre falls between two pixels; `side` is in pixels. The square may reach past the
 * image: there is nothing there. */
export function visibleSquare({ width, height, pixels }) {
  let [left, top, right, bottom] = [width, height, -1, -1];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alphaAt(pixels, (y * width + x) * 4) === 0) continue;
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  if (right < 0) throw new Error('Nothing in the image is visible');
  const longer = Math.max(right - left + 1, bottom - top + 1);
  return { x: left + right + 1, y: top + bottom + 1, side: longer + 2 * Math.ceil(longer / MARGIN_SHARE) };
}

/** For each of the `size` icon pixels along one axis, the source pixels it covers as `[index, length covered]`. Lengths are
 * in units of 1 / (2 × size) of a source pixel, which makes every edge a whole number: a source pixel is 2 × size long, an
 * icon pixel 2 × side. Source pixels outside 0…`limit` are left out. */
function covered(centre, side, size, limit) {
  const start = size * (centre - side);
  return Array.from({ length: size }, (_, index) => {
    const [from, to] = [start + 2 * side * index, start + 2 * side * (index + 1)];
    const found = [];
    for (let at = Math.max(0, Math.floor(from / (2 * size))); at < limit && 2 * size * at < to; at++) {
      found.push([at, Math.min(to, 2 * size * (at + 1)) - Math.max(from, 2 * size * at)]);
    }
    return found;
  });
}

/** `sum / count`, rounded to the nearest whole number (a half goes up), without leaving whole numbers. */
const rounded = (sum, count) => Math.floor((2 * sum + count) / (2 * count));

/** RGBA pixels, row by row, of `square` cut from `image` and scaled to `size` × `size`. An icon pixel's alpha is the
 * average alpha of the area it covers; its colour is the average colour of that area weighted by alpha (premultiplied),
 * so a pixel that is half logo and half transparent ground keeps the logo's colour at half the alpha. */
export function scaleDown(image, square, size) {
  const { width, pixels } = image;
  const columns = covered(square.x, square.side, size, width);
  const rows = covered(square.y, square.side, size, image.height);
  const whole = 4 * square.side * square.side; // the area of one icon pixel, in the units of `covered`
  const scaled = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let [r, g, b, a] = [0, 0, 0, 0];
      for (const [y, tall] of rows[py]) {
        for (const [x, wide] of columns[px]) {
          const at = (y * width + x) * 4;
          const weight = tall * wide * alphaAt(pixels, at);
          r += weight * pixels[at]; g += weight * pixels[at + 1]; b += weight * pixels[at + 2]; a += weight;
        }
      }
      const alpha = rounded(a, whole);
      if (alpha > 0) scaled.set([rounded(r, a), rounded(g, a), rounded(b, a), alpha], (py * size + px) * 4);
    }
  }
  return scaled;
}

/** The owner's logo, read from `file`. */
export function readSource(file = SOURCE) {
  const name = path.relative(root, file);
  if (!existsSync(file)) throw new Error(`${name} is missing`);
  return decodePng(readFileSync(file), name);
}

/** RGBA pixels, row by row, of the icon at `size` × `size`, made from `image`: the owner's logo unless another is given. */
export function renderIcon(size, image = readSource()) {
  return scaleDown(image, visibleSquare(image), size);
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** An 8-bit RGBA PNG of `pixels`. Every row has filter type 2 (up: each byte less the byte above it), which leaves mostly
 * zeros and small numbers where the picture changes slowly. The rows are packed by run length and Huffman coding alone
 * (Z_RLE): zlib's search for repeats is left out, because builds of zlib differ in it, and with it the same rows came out
 * as other bytes from one build than from the next. */
export function encodePng(width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8); // bit depth 8, RGBA, deflate, adaptive filtering, no interlace
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const [from, to] = [y * stride, y * (stride + 1) + 1];
    raw[to - 1] = 2;
    for (let x = 0; x < stride; x++) raw[to + x] = (pixels[from + x] - (y > 0 ? pixels[from + x - stride] : 0)) & 255;
  }
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { strategy: zlib.constants.Z_RLE })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Writes every icon size to `dir`, made from `image`, and returns the files written. */
export function writeIcons(dir = ICONS_DIR, image = readSource()) {
  mkdirSync(dir, { recursive: true });
  return ICON_SIZES.map(size => {
    const file = path.join(dir, `${size}.png`);
    writeFileSync(file, encodePng(size, size, renderIcon(size, image)));
    return file;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    for (const file of writeIcons()) console.log(`Wrote ${path.relative(root, file)}`);
  } catch (error) {
    console.error(`Cannot make the icons: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
