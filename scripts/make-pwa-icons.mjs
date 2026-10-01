// Generates the PWA icon set (packages/web/ui/public/icons/*.png) with ZERO
// dependencies: raw RGBA rasterizer (3×3 supersampled geometric coverage) +
// a minimal PNG encoder over node:zlib. Run from the repo root:
//   node scripts/make-pwa-icons.mjs
// The PNGs are committed; this script only re-runs when the mark changes.
//
// The mark is the README's 星芒徽标 (assets/readme/hero.svg): an amber
// four-pointed nova star with a smaller secondary sparkle at reduced opacity,
// lifted verbatim from the hero geometry and re-centered on the canvas. The
// badge follows the reference app icon's composition: a WHITE rounded square
// (full-bleed in the maskable variant) with the mark centered.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(fileURLToPath(import.meta.url), '..', '..', 'packages', 'web', 'ui', 'public', 'icons');

// Brand colors lifted from the design platform tokens (design-platform.css):
// amber-500 mark on the light badge (the hero's pairing on #ffffff).
const BADGE = [255, 255, 255];
const MARK = [232, 161, 60]; // #e8a13c — the hero star's fill

function pngEncode(rgba, size) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // Scanlines with filter 0, deflated.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const inRoundedRect = (x, y, rx, ry, w, h, r) => {
  // Rounded rectangle = straight core (two bands) plus four quarter-circles.
  const inCoreX = x >= rx + r && x <= rx + w - r && y >= ry && y <= ry + h;
  const inCoreY = y >= ry + r && y <= ry + h - r && x >= rx && x <= rx + w;
  if (inCoreX || inCoreY) return true;
  const nx = Math.max(rx + r, Math.min(x, rx + w - r));
  const ny = Math.max(ry + r, Math.min(y, ry + h - r));
  return (x - nx) ** 2 + (y - ny) ** 2 <= r * r;
};

/** Even-odd ray casting against an 8-vertex star polygon. */
function inPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0];
    const yi = pts[i][1];
    const xj = pts[j][0];
    const yj = pts[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The hero star's geometry, generalized. On the hero's 100/108-center grid
 * the outer radius is 54 and the waist points sit at (±8, ∓10) — a concave
 * four-pointed nova. Parameters are the center, outer radius and this grid,
 * so the small sparkle reuses the exact same shape.
 */
function starPoints(cx, cy, r) {
  const wx = (8 / 54) * r;
  const wy = (10 / 54) * r;
  return [
    [cx, cy - r],
    [cx + wx, cy - wy],
    [cx + r, cy],
    [cx + wx, cy + wy],
    [cx, cy + r],
    [cx - wx, cy + wy],
    [cx - r, cy],
    [cx - wx, cy - wy],
  ];
}

/** Coverage of the mark at (x, y): main star + secondary sparkle opacity. */
function markCoverage(x, y, cx, cy, r) {
  let alpha = 0;
  if (inPolygon(x, y, starPoints(cx, cy, r))) alpha = 1;
  // Secondary sparkle: offset (+1.04R, −0.89R) at 0.33R, 0.55 opacity — the
  // hero's `opacity="0.55"` twin.
  const sx = cx + 1.04 * r;
  const sy = cy - 0.89 * r;
  const sr = 0.33 * r;
  if (inPolygon(x, y, starPoints(sx, sy, sr))) alpha = Math.max(alpha, 0.55);
  return alpha;
}

function render(size, { maskable }) {
  const px = Buffer.alloc(size * size * 4);
  const SS = 3; // 3×3 supersampling → smooth edges at both sizes
  const s = size / 512;
  const badgeR = maskable ? 0 : 112 * s;
  const badgePad = maskable ? 0 : 32 * s;
  // The mark's total extent is 1.37R to one side (star R plus the sparkle at
  // 1.04R + 0.33R). Fit it with the hero's proportions: mark ≈ 60% of the
  // badge width for "any", inside the maskable 80% safe zone for maskable.
  const starR = (maskable ? 0.27 : 0.31) * size;
  const cx = size / 2;
  const cy = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let badge = 0;
      let mark = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const pxX = x + (sx + 0.5) / SS;
          const pxY = y + (sy + 0.5) / SS;
          const inBadge =
            pxX >= badgePad && pxY >= badgePad &&
            pxX <= size - badgePad && pxY <= size - badgePad &&
            inRoundedRect(pxX, pxY, badgePad, badgePad, size - 2 * badgePad, size - 2 * badgePad, badgeR);
          if (inBadge) badge++;
          mark += markCoverage(pxX, pxY, cx, cy, starR);
        }
      }
      const i = (y * size + x) * 4;
      if (badge === 0) continue; // transparent outside the badge
      const badgeA = badge / (SS * SS);
      const markA = mark / (SS * SS);
      px[i] = Math.round(BADGE[0] * (1 - markA) + MARK[0] * markA);
      px[i + 1] = Math.round(BADGE[1] * (1 - markA) + MARK[1] * markA);
      px[i + 2] = Math.round(BADGE[2] * (1 - markA) + MARK[2] * markA);
      px[i + 3] = Math.round(badgeA * 255);
    }
  }
  return pngEncode(px, size);
}

mkdirSync(OUT, { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(join(OUT, `icon-${size}.png`), render(size, { maskable: false }));
  writeFileSync(join(OUT, `maskable-${size}.png`), render(size, { maskable: true }));
}
console.log(`icons written to ${OUT}`);
