/**
 * Draws the Ledge marks from one description, with no image libraries, so the identity can be
 * regenerated on any machine that has Node:
 *
 *   node icons/make-icons.mjs && npm run tauri icon icons/source.png
 *
 * Two outputs, because they have different jobs.
 *
 *   source.png  1024 square, a colour plate. The Tauri CLI fans this out into every size and
 *               container the bundler needs.
 *   tray.png    44 square, a template image: black shapes on transparency and nothing else.
 *               macOS recolours a template itself, white on a dark menu bar and black on a
 *               light one. A colour plate up there renders as a solid block, so the template
 *               is the plate outline with the L cut out of it rather than a filled square.
 *
 * The mark is a near-black rounded square carrying a white L, with a green dot resting in the
 * crook of the letter. The dot is the same green the panel uses for live work, so the icon says
 * the same thing the interface says: something is running. Drawn from solid geometry rather than
 * a font, both because a font would have to be embedded and because an L at 16 pixels needs its
 * stem and foot thickened past what any real typeface would do.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ geometry */

// Everything on a 0 to 1 grid, so every size draws the same thing.
const PLATE_CORNER = 0.219; // 224 of 1024, the macOS app icon corner
// The L: a vertical stem and a horizontal foot, as two overlapping rounded bars.
const STEM = { x0: 0.285, y0: 0.235, x1: 0.42, y1: 0.7, r: 0.026 };
const FOOT = { x0: 0.285, y0: 0.615, x1: 0.63, y1: 0.7, r: 0.026 };
// The dot sits in the crook, overlapping the foot's right end.
const DOT = { cx: 0.675, cy: 0.672, r: 0.088 };

const PLATE = [0x1b, 0x1c, 0x20];
const LETTER = [0xff, 0xff, 0xff];
const LIVE = [0x30, 0xc7, 0x5e];

/** Smooth 0 to 1 ramp, so every edge eases rather than stepping. */
function smooth(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Coverage of a rounded rectangle at a point, as a signed distance, so edges come out
 * antialiased at every size instead of stepped.
 */
function rect(x, y, s, scale) {
  const r = s.r * scale;
  const left = s.x0 * scale + r;
  const top = s.y0 * scale + r;
  const right = s.x1 * scale - r;
  const bottom = s.y1 * scale - r;
  const nx = Math.max(left, Math.min(x, right));
  const ny = Math.max(top, Math.min(y, bottom));
  const dx = x - nx;
  const dy = y - ny;
  return Math.max(0, Math.min(1, 0.5 - (Math.sqrt(dx * dx + dy * dy) - r)));
}

/** Coverage of a circle at a point. */
function circle(x, y, c, scale) {
  const d = Math.sqrt((x - c.cx * scale) ** 2 + (y - c.cy * scale) ** 2);
  return smooth(c.r * scale + 0.7, c.r * scale - 0.7, d);
}

/** Coverage of the L glyph at a point: the stem or the foot, whichever covers more. */
function letterCoverage(x, y, scale) {
  return Math.max(rect(x, y, STEM, scale), rect(x, y, FOOT, scale));
}

/* ------------------------------------------------------------------ colour */

/** Blends two colours by t in 0 to 1. */
function mix(a, b, t) {
  const k = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

/* ------------------------------------------------------------------ png encoding */

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

/** Encodes straight RGBA bytes as a truecolour-with-alpha PNG. */
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y += 1) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * size * 4, y * size * 4 + size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ the two assets */

/** The application icon: the white L and its green dot on a near-black rounded plate. */
function drawAppIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const plate = { x0: 0, y0: 0, x1: 1, y1: 1, r: PLATE_CORNER };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      let rgb = PLATE;
      rgb = mix(rgb, LETTER, letterCoverage(px, py, size));
      // The dot goes on last so it sits over the foot of the letter, which is what puts it
      // in the crook rather than beside it.
      rgb = mix(rgb, LIVE, circle(px, py, DOT, size));
      const o = (y * size + x) * 4;
      rgba[o] = rgb[0];
      rgba[o + 1] = rgb[1];
      rgba[o + 2] = rgb[2];
      rgba[o + 3] = Math.round(rect(px, py, plate, size) * 255);
    }
  }
  return encodePng(size, rgba);
}

/**
 * The menu bar icon: the plate's silhouette with the L and the dot cut out of it. A template
 * image has only alpha to work with, so the letter has to be a hole rather than a fill, and the
 * green dot becomes a hole too. Inset slightly, because a menu bar slot wants breathing room.
 */
function drawTrayIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const inset = 0.07;
  const span = 1 - inset * 2;
  const plate = { x0: 0, y0: 0, x1: 1, y1: 1, r: PLATE_CORNER };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // Work in the mark's own frame, so the glyph keeps its proportions inside the inset.
      const mx = ((x + 0.5) / size - inset) / span * size;
      const my = ((y + 0.5) / size - inset) / span * size;
      let a = rect(mx, my, plate, size);
      a -= letterCoverage(mx, my, size);
      a -= circle(mx, my, DOT, size);
      const o = (y * size + x) * 4;
      rgba[o] = 0;
      rgba[o + 1] = 0;
      rgba[o + 2] = 0;
      rgba[o + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
    }
  }
  return encodePng(size, rgba);
}

const app = drawAppIcon(1024);
writeFileSync(join(HERE, 'source.png'), app);
console.log(`wrote source.png  1024x1024 colour plate, ${(app.length / 1024).toFixed(1)} kB`);

const tray = drawTrayIcon(44);
writeFileSync(join(HERE, 'tray.png'), tray);
console.log(`wrote tray.png    44x44 template, ${tray.length} bytes`);
