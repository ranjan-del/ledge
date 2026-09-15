/**
 * Draws the menu bar icon as a template image: black shapes on transparency, nothing else.
 * macOS recolours a template icon itself, white on a dark menu bar and black on a light one,
 * which is why a normal coloured icon renders as a solid block up there.
 *
 *   node icons/make-tray-icon.mjs
 *
 * The mark is the same shelf with two blocks as the application icon, redrawn at 22 points
 * with heavier weights, because at this size the gaps close up before the strokes do.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 44 pixels is the 2x asset for a 22 point menu bar item.
const SIZE = 44;

/**
 * Coverage of a rounded rectangle at a point, as a signed distance, so edges come out smooth
 * rather than stepped at this size.
 */
function coverage(x, y, left, top, right, bottom, radius) {
  const cx = Math.max(left + radius, Math.min(x, right - radius));
  const cy = Math.max(top + radius, Math.min(y, bottom - radius));
  const dx = x - cx;
  const dy = y - cy;
  return Math.max(0, Math.min(1, 0.5 - (Math.sqrt(dx * dx + dy * dy) - radius)));
}

// Laid out on a 44 unit grid with a 3 unit breathing space all round.
const shelf = { left: 5, top: 27, right: 39, bottom: 33, radius: 3 };
const tall = { left: 10, top: 12, right: 20, bottom: 27, radius: 2 };
const short = { left: 24, top: 18, right: 34, bottom: 27, radius: 2 };

const pixels = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y += 1) {
  for (let x = 0; x < SIZE; x += 1) {
    let alpha = 0;
    for (const s of [shelf, tall, short]) {
      alpha = Math.max(alpha, coverage(x + 0.5, y + 0.5, s.left, s.top, s.right, s.bottom, s.radius));
    }
    const o = (y * SIZE + x) * 4;
    // Black, with the shape carried entirely by the alpha channel.
    pixels[o] = 0;
    pixels[o + 1] = 0;
    pixels[o + 2] = 0;
    pixels[o + 3] = Math.round(alpha * 255);
  }
}

const CRC = new Int32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC[n] = c;
}

/** Standard PNG chunk checksum over the type and data bytes. */
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** Wraps a payload as a length-prefixed, checksummed PNG chunk. */
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;
ihdr[9] = 6;

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y += 1) {
  raw[y * (SIZE * 4 + 1)] = 0;
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, y * SIZE * 4 + SIZE * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = join(dirname(fileURLToPath(import.meta.url)), 'tray.png');
writeFileSync(out, png);
console.log(`wrote ${out} (${SIZE}x${SIZE} template, ${png.length} bytes)`);
