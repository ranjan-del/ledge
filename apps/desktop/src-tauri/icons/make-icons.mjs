/**
 * Draws both Ledge marks from one description, with no image libraries, so the identity can be
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
 *               light one. A colour plate up there renders as a solid block.
 *
 * The mark is an orb with two eyes: a soft violet sphere lit from the upper left, ringed by a
 * bright halo, with a pair of white capsule eyes. It is a face reduced to the two features that
 * still read at 16 pixels. The colour and the glow carry the character at large sizes; at menu
 * bar size everything but the silhouette and the eyes falls away, which is why the template
 * variant is only a disc with two holes in it and still looks like the same creature.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ geometry */

// Everything is described on a 0 to 1 grid so both sizes draw the same thing.
const ORB = { cx: 0.5, cy: 0.475, r: 0.315 };
const EYE = { dx: 0.093, cy: 0.475, w: 0.062, h: 0.135, r: 0.031 };
const SHADOW = { cx: 0.5, cy: 0.855, rx: 0.2, ry: 0.035 };
const HALO_WIDTH = 0.055;
const PLATE_CORNER = 0.219; // 224 of 1024, the macOS app icon corner

/** Smooth 0 to 1 ramp, used so every edge and falloff eases instead of stepping. */
function smooth(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Coverage of a rounded rectangle at a point, as a signed distance, so the eyes come out with
 * clean antialiased edges at every size rather than stepped ones.
 */
function roundedRect(x, y, x0, y0, x1, y1, radius, scale) {
  const r = radius * scale;
  const left = x0 * scale + r;
  const top = y0 * scale + r;
  const right = x1 * scale - r;
  const bottom = y1 * scale - r;
  const nx = Math.max(left, Math.min(x, right));
  const ny = Math.max(top, Math.min(y, bottom));
  const dx = x - nx;
  const dy = y - ny;
  return Math.max(0, Math.min(1, 0.5 - (Math.sqrt(dx * dx + dy * dy) - r)));
}

/** Combined coverage of the two eyes at a point. */
function eyeCoverage(x, y, scale) {
  const left = roundedRect(
    x, y,
    ORB.cx - EYE.dx - EYE.w / 2, EYE.cy - EYE.h / 2,
    ORB.cx - EYE.dx + EYE.w / 2, EYE.cy + EYE.h / 2,
    EYE.r, scale,
  );
  const right = roundedRect(
    x, y,
    ORB.cx + EYE.dx - EYE.w / 2, EYE.cy - EYE.h / 2,
    ORB.cx + EYE.dx + EYE.w / 2, EYE.cy + EYE.h / 2,
    EYE.r, scale,
  );
  return Math.max(left, right);
}

/* ------------------------------------------------------------------ colour */

const PLATE_TOP = [0xf2, 0xf1, 0xfd];
const PLATE_BOTTOM = [0xe4, 0xe8, 0xfb];
const ORB_HIGHLIGHT = [0xd6, 0xa8, 0xf2]; // pink violet, upper left
const ORB_MID = [0x8d, 0x7b, 0xef]; // the body of the sphere
const ORB_DEEP = [0x50, 0x63, 0xe6]; // blue, lower right
const WHITE = [0xff, 0xff, 0xff];

/** Blends two colours by t in 0 to 1. */
function mix(a, b, t) {
  const k = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

/**
 * The sphere's colour at a point inside it. Two blends stacked: a diagonal sweep from the pink
 * upper left to the blue lower right gives it a light source, and a second blend toward the
 * highlight near the top left corner keeps the surface from reading flat.
 */
function orbColour(nx, ny) {
  const diagonal = (nx + ny + 2) / 4; // 0 at the upper left of the sphere, 1 at the lower right
  let rgb = mix(ORB_MID, ORB_DEEP, smooth(0.35, 1.0, diagonal));
  rgb = mix(rgb, ORB_HIGHLIGHT, smooth(0.6, 0.0, diagonal) * 0.85);
  return rgb;
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

/** The application icon: the lit orb on a pale lavender plate, with its halo and its shadow. */
function drawAppIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const cx = ORB.cx * size;
  const cy = ORB.cy * size;
  const r = ORB.r * size;
  const halo = HALO_WIDTH * size;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      let rgb = mix(PLATE_TOP, PLATE_BOTTOM, y / (size - 1));

      // Contact shadow, drawn first so everything else sits over it.
      const sx = (px - SHADOW.cx * size) / (SHADOW.rx * size);
      const sy = (py - SHADOW.cy * size) / (SHADOW.ry * size);
      const shade = smooth(1.35, 0.0, Math.sqrt(sx * sx + sy * sy));
      rgb = mix(rgb, [0x6d, 0x6a, 0xa8], shade * 0.3);

      const d = Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));

      // Halo: brightest right at the rim, gone a little way out, and it also bleeds a touch
      // inward so the sphere looks lit from behind rather than pasted on.
      const outward = smooth(r + halo, r, d);
      const inward = smooth(r - halo * 0.8, r, d);
      const glow = d >= r ? outward : inward * 0.55;
      rgb = mix(rgb, WHITE, glow * 0.95);

      // The sphere itself.
      const inside = smooth(r + 0.75, r - 0.75, d);
      if (inside > 0) {
        const nx = (px - cx) / r;
        const ny = (py - cy) / r;
        rgb = mix(rgb, orbColour(nx, ny), inside);
        const eyes = eyeCoverage(px, py, size);
        if (eyes > 0) rgb = mix(rgb, WHITE, eyes);
      }

      const plateAlpha = roundedRect(px, py, 0, 0, 1, 1, PLATE_CORNER, size);
      const o = (y * size + x) * 4;
      rgba[o] = rgb[0];
      rgba[o + 1] = rgb[1];
      rgba[o + 2] = rgb[2];
      rgba[o + 3] = Math.round(plateAlpha * 255);
    }
  }
  return encodePng(size, rgba);
}

/**
 * The menu bar icon: the same creature reduced to a disc with two eye holes, black on
 * transparency. No halo and no shadow, because a template image has no colour to carry them
 * and macOS would render any grey as a muddy blob.
 */
function drawTrayIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  // A menu bar slot wants the mark slightly smaller than the full square.
  const scale = 0.92;
  const cx = size / 2;
  const cy = size / 2;
  const r = ORB.r * size * scale * (1 / 0.95);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const d = Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
      let a = smooth(r + 0.7, r - 0.7, d);
      // Eyes, mapped into the disc's own frame so they keep their position and proportion.
      const ex = (px - cx) / (r / (ORB.r * size)) + ORB.cx * size;
      const ey = (py - cy) / (r / (ORB.r * size)) + ORB.cy * size;
      a = Math.max(0, a - eyeCoverage(ex, ey, size));
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
