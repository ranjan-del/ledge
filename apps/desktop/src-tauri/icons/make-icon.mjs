/**
 * Draws the Ledge source icon as a 1024x1024 PNG with no image libraries, so the mark can be
 * regenerated from source on any machine that has Node. The Tauri CLI turns the file this writes
 * into every size and container the bundler needs:
 *
 *   node icons/make-icon.mjs && npm run tauri icon icons/source.png
 *
 * The mark is a shelf with two blocks resting on it: the tasks on your ledge. It is drawn with
 * flat shapes and generous weights because the smallest rendering is 16 pixels wide.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 1024;
const TEAL_TOP = [0x14, 0x9a, 0xa4];
const TEAL_BOTTOM = [0x0a, 0x5c, 0x64];
const WHITE = [0xff, 0xff, 0xff];
const CORNER = 224;

/** Blends two colours by t in 0..1, used for the background's vertical gradient. */
function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/**
 * Coverage of a rounded rectangle at a point, sampled as a signed distance so edges come out
 * smooth instead of stepped. Returns 0 outside, 1 inside, and a fraction across the one pixel
 * band on the boundary.
 */
function roundedCoverage(x, y, left, top, right, bottom, radius) {
  const cx = Math.max(left + radius, Math.min(x, right - radius));
  const cy = Math.max(top + radius, Math.min(y, bottom - radius));
  const dx = x - cx;
  const dy = y - cy;
  const distance = Math.sqrt(dx * dx + dy * dy) - radius;
  return Math.max(0, Math.min(1, 0.5 - distance));
}

/** Paints src over dst with the given coverage, both as plain RGB triples. */
function over(dst, src, coverage) {
  if (coverage <= 0) return dst;
  if (coverage >= 1) return src;
  return mix(dst, src, coverage);
}

const pixels = Buffer.alloc(SIZE * SIZE * 4);

// Shelf and the two blocks standing on it, in source pixels.
const shelf = { left: 168, top: 606, right: 856, bottom: 686, radius: 40 };
const blockLeft = { left: 236, top: 330, right: 452, bottom: 606, radius: 34 };
const blockRight = { left: 508, top: 438, right: 724, bottom: 606, radius: 34 };

for (let y = 0; y < SIZE; y += 1) {
  const ground = mix(TEAL_TOP, TEAL_BOTTOM, y / (SIZE - 1));
  for (let x = 0; x < SIZE; x += 1) {
    const plate = roundedCoverage(x + 0.5, y + 0.5, 0, 0, SIZE, SIZE, CORNER);
    let rgb = ground;
    for (const shape of [blockLeft, blockRight, shelf]) {
      const coverage = roundedCoverage(
        x + 0.5,
        y + 0.5,
        shape.left,
        shape.top,
        shape.right,
        shape.bottom,
        shape.radius,
      );
      rgb = over(rgb, WHITE, coverage);
    }
    const offset = (y * SIZE + x) * 4;
    pixels[offset] = rgb[0];
    pixels[offset + 1] = rgb[1];
    pixels[offset + 2] = rgb[2];
    pixels[offset + 3] = Math.round(plate * 255);
  }
}

const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}

/** Standard PNG chunk checksum over the type and data bytes. */
function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** Wraps a payload as a length-prefixed, checksummed PNG chunk. */
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // truecolour with alpha
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y += 1) {
  const from = y * SIZE * 4;
  raw[y * (SIZE * 4 + 1)] = 0; // no per scanline filter
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, from, from + SIZE * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = join(dirname(fileURLToPath(import.meta.url)), 'source.png');
writeFileSync(out, png);
console.log(`wrote ${out} (${SIZE}x${SIZE}, ${(png.length / 1024).toFixed(1)} kB)`);
