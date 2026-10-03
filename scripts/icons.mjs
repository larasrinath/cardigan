// Draws the extension's icons (icons/16.png, 32.png, 48.png, 128.png): a cream card with a mustard title bar and two rows,
// on a rust rounded square. Shapes are defined on a 128-unit grid and sampled 8 × 8 times per pixel, so every size is
// drawn from the same geometry with smooth edges. Node built-ins only: node:zlib writes the PNG data.
// Run `npm run icons` to regenerate them.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ICONS_DIR = path.join(root, 'icons');
export const ICON_SIZES = [16, 32, 48, 128];

const GRID = 128;
const SAMPLES = 8;
const RUST = [155, 58, 46];
const CREAM = [255, 247, 234];
const MUSTARD = [224, 164, 58];
const ROW = [196, 108, 94];

/** Inside a rectangle with rounded corners (all four, radius `r`). */
const rounded = (x0, y0, x1, y1, r) => (x, y) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const dx = x < x0 + r ? x0 + r - x : x > x1 - r ? x - (x1 - r) : 0;
  const dy = y < y0 + r ? y0 + r - y : y > y1 - r ? y - (y1 - r) : 0;
  return dx * dx + dy * dy <= r * r;
};

const background = rounded(0, 0, 128, 128, 26);
const card = rounded(22, 24, 106, 104, 12);
const titleBar = (x, y) => card(x, y) && y < 50;
const rows = [rounded(34, 62, 94, 74, 6), rounded(34, 84, 76, 96, 6)];

/** The colour at a point of the 128-unit grid, or undefined where the icon is transparent. Later shapes paint over earlier ones. */
function colourAt(x, y) {
  if (!background(x, y)) return undefined;
  if (!card(x, y)) return RUST;
  if (titleBar(x, y)) return MUSTARD;
  if (rows.some(row => row(x, y))) return ROW;
  return CREAM;
}

/** RGBA pixels, row by row, of the icon at `size` × `size`. Edge pixels average their samples (premultiplied by coverage). */
export function renderIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const scale = GRID / size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let [r, g, b, covered] = [0, 0, 0, 0];
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const colour = colourAt((px + (sx + 0.5) / SAMPLES) * scale, (py + (sy + 0.5) / SAMPLES) * scale);
          if (!colour) continue;
          r += colour[0]; g += colour[1]; b += colour[2]; covered++;
        }
      }
      const at = (py * size + px) * 4;
      if (covered) {
        pixels[at] = Math.round(r / covered);
        pixels[at + 1] = Math.round(g / covered);
        pixels[at + 2] = Math.round(b / covered);
        pixels[at + 3] = Math.round((covered * 255) / (SAMPLES * SAMPLES));
      }
    }
  }
  return pixels;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** An 8-bit RGBA PNG of `pixels`, every row with filter type 0 (none). */
export function encodePng(width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8); // bit depth 8, RGBA, deflate, adaptive filtering, no interlace
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Writes every icon size to `dir` and returns the files written. */
export function writeIcons(dir = ICONS_DIR) {
  mkdirSync(dir, { recursive: true });
  return ICON_SIZES.map(size => {
    const file = path.join(dir, `${size}.png`);
    writeFileSync(file, encodePng(size, size, renderIcon(size)));
    return file;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  for (const file of writeIcons()) console.log(`Wrote ${path.relative(root, file)}`);
}
