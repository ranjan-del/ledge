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
 * The mark is a robot head, because the thing behind the button is an assistant and it should
 * look like one. It is drawn from solid geometry rather than strokes so it survives being
 * shrunk to 16 pixels, where a monoline outline turns to mush. The features are deliberately
 * few: an antenna, a head, two eyes and a mouth. Anything more disappears at menu bar size.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ the drawing */

/**
 * The robot, described once on a 0 to 1 grid so both sizes draw the same thing. `add` shapes
 * build the silhouette, `cut` shapes are removed from it, which is what makes the eyes and
 * mouth read as holes in both a coloured plate and a transparent template.
 */
const ROBOT = {
  add: [
    // Antenna: a stalk with a ball on top, offset slightly left so the head is not a perfect
    // mirror. A face with no asymmetry at all reads as a logo rather than a character.
    { kind: 'circle', cx: 0.44, cy: 0.145, r: 0.062 },
    { kind: 'rect', x0: 0.424, y0: 0.185, x1: 0.456, y1: 0.275, r: 0.016 },
    // Head.
    { kind: 'rect', x0: 0.175, y0: 0.265, x1: 0.825, y1: 0.735, r: 0.15 },
    // Ears.
    { kind: 'rect', x0: 0.108, y0: 0.415, x1: 0.183, y1: 0.585, r: 0.037 },
    { kind: 'rect', x0: 0.817, y0: 0.415, x1: 0.892, y1: 0.585, r: 0.037 },
    // Neck and shoulders, so the head is not floating.
    { kind: 'rect', x0: 0.425, y0: 0.735, x1: 0.575, y1: 0.79, r: 0.02 },
    { kind: 'rect', x0: 0.255, y0: 0.79, x1: 0.745, y1: 0.87, r: 0.055 },
  ],
  cut: [
    // Eyes. Tall rounded slots rather than dots: at 16 pixels a dot vanishes, a slot holds.
    { kind: 'rect', x0: 0.295, y0: 0.375, x1: 0.415, y1: 0.525, r: 0.055 },
    { kind: 'rect', x0: 0.585, y0: 0.375, x1: 0.705, y1: 0.525, r: 0.055 },
    // Mouth.
    { kind: 'rect', x0: 0.355, y0: 0.605, x1: 0.645, y1: 0.655, r: 0.025 },
    // A notch out of the shoulders, which reads as arms without drawing any.
    { kind: 'rect', x0: 0.455, y0: 0.845, x1: 0.545, y1: 0.885, r: 0.018 },
  ],
};

/**
 * Coverage of a shape at a point, sampled as a signed distance so edges come out smooth rather
 * than stepped. Returns 0 outside, 1 inside, and a fraction across the one pixel boundary band.
 * Both shape kinds reduce to the same rounded-rectangle distance, a circle being the case where
 * the rectangle has collapsed to its centre.
 */
function coverage(shape, x, y, scale) {
  let left;
  let top;
  let right;
  let bottom;
  let radius;
  if (shape.kind === 'circle') {
    left = shape.cx * scale;
    top = shape.cy * scale;
    right = left;
    bottom = top;
    radius = shape.r * scale;
  } else {
    radius = shape.r * scale;
    left = shape.x0 * scale + radius;
    top = shape.y0 * scale + radius;
    right = shape.x1 * scale - radius;
    bottom = shape.y1 * scale - radius;
  }
  const nx = Math.max(left, Math.min(x, right));
  const ny = Math.max(top, Math.min(y, bottom));
  const dx = x - nx;
  const dy = y - ny;
  return Math.max(0, Math.min(1, 0.5 - (Math.sqrt(dx * dx + dy * dy) - radius)));
}

/** Silhouette coverage at a point: everything added, minus everything cut. */
function robotCoverage(x, y, scale) {
  let on = 0;
  for (const s of ROBOT.add) on = Math.max(on, coverage(s, x, y, scale));
  let off = 0;
  for (const s of ROBOT.cut) off = Math.max(off, coverage(s, x, y, scale));
  return Math.max(0, on - off);
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

const TEAL_TOP = [0x18, 0xa5, 0xaf];
const TEAL_BOTTOM = [0x09, 0x51, 0x59];
const PLATE_CORNER = 0.219; // 224 of 1024, the macOS app icon corner

/** Blends two colours by t in 0 to 1. */
function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/** The application icon: a white robot on a rounded teal plate with a vertical gradient. */
function drawAppIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const plate = {
    kind: 'rect',
    x0: 0,
    y0: 0,
    x1: 1,
    y1: 1,
    r: PLATE_CORNER,
  };
  // The robot is inset so it does not crowd the plate's corners.
  const inset = 0.1;
  const span = 1 - inset * 2;
  for (let y = 0; y < size; y += 1) {
    const ground = mix(TEAL_TOP, TEAL_BOTTOM, y / (size - 1));
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const onPlate = coverage(plate, px, py, size);
      const rx = (px / size - inset) / span;
      const ry = (py / size - inset) / span;
      const onRobot = rx < -0.2 || rx > 1.2 || ry < -0.2 || ry > 1.2
        ? 0
        : robotCoverage(rx * size, ry * size, size);
      const rgb = mix(ground, [0xff, 0xff, 0xff], onRobot);
      const o = (y * size + x) * 4;
      rgba[o] = rgb[0];
      rgba[o + 1] = rgb[1];
      rgba[o + 2] = rgb[2];
      rgba[o + 3] = Math.round(onPlate * 255);
    }
  }
  return encodePng(size, rgba);
}

/** The menu bar icon: the same robot as black on transparency, with no plate behind it. */
function drawTrayIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  // Menu bar items want a little breathing room inside their slot.
  const inset = 0.06;
  const span = 1 - inset * 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const rx = (x + 0.5) / size;
      const ry = (y + 0.5) / size;
      const a = robotCoverage(((rx - inset) / span) * size, ((ry - inset) / span) * size, size);
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
