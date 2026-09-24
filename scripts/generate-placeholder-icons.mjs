#!/usr/bin/env node
/**
 * 生成 Yoyo Code 的占位图标全套。
 *
 * 设计：圆角方形 + 对角渐变底 + 圆头笔画字母 Y。
 * 每个尺寸都按解析式抗锯齿（有向距离场）独立光栅化，不做缩放重采样，
 * 因此 16x16 这类小尺寸也能保持笔画清晰。
 *
 * 这是占位图标：拿到正式设计稿后，把等尺寸 PNG 覆盖到同样的路径即可，
 * 不需要改任何代码。用法：node scripts/generate-placeholder-icons.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { Icns, IcnsImage } from "@fiahfy/icns";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ── 设计参数（归一化到 0..1，随尺寸等比放大）─────────────────────────────
/** macOS Big Sur 风格圆角比例。 */
const CORNER_RADIUS = 0.2237;
/** 字母笔画半宽，对应整笔画宽度约为画布的 11.6%。 */
const STROKE_HALF_WIDTH = 0.058;
const ARM_LEFT = [0.325, 0.265];
const ARM_RIGHT = [0.675, 0.265];
const ARM_JOIN = [0.5, 0.455];
const STEM_END = [0.5, 0.725];
const GRADIENT_FROM = [0x63, 0x66, 0xf1];
const GRADIENT_TO = [0x43, 0x38, 0xca];
const GLYPH_COLOR = [0xff, 0xff, 0xff];

// ── 几何：有向距离场 ───────────────────────────────────────────────────
function roundedRectDistance(px, py, size, radius) {
  const half = size / 2;
  const dx = Math.abs(px - half) - (half - radius);
  const dy = Math.abs(py - half) - (half - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

/** 到线段的距离，两端按 round cap 处理。 */
function capsuleDistance(px, py, [ax, ay], [bx, by]) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const lengthSquared = vx * vx + vy * vy;
  const t = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, (wx * vx + wy * vy) / lengthSquared));
  return Math.hypot(wx - t * vx, wy - t * vy);
}

/** 把距离转成 0..1 覆盖率：边缘在一个像素内过渡，得到抗锯齿。 */
function coverage(distance) {
  return Math.min(1, Math.max(0, 0.5 - distance));
}

function renderRgba(size) {
  const radius = CORNER_RADIUS * size;
  const strokeHalfWidth = STROKE_HALF_WIDTH * size;
  const scalePoint = ([x, y]) => [x * size, y * size];
  const armLeft = scalePoint(ARM_LEFT);
  const armRight = scalePoint(ARM_RIGHT);
  const armJoin = scalePoint(ARM_JOIN);
  const stemEnd = scalePoint(STEM_END);

  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const backgroundAlpha = coverage(roundedRectDistance(px, py, size, radius));
      if (backgroundAlpha <= 0) continue;

      const t = (px + py) / (2 * size);
      let r = GRADIENT_FROM[0] + (GRADIENT_TO[0] - GRADIENT_FROM[0]) * t;
      let g = GRADIENT_FROM[1] + (GRADIENT_TO[1] - GRADIENT_FROM[1]) * t;
      let b = GRADIENT_FROM[2] + (GRADIENT_TO[2] - GRADIENT_FROM[2]) * t;

      const glyphDistance =
        Math.min(
          capsuleDistance(px, py, armLeft, armJoin),
          capsuleDistance(px, py, armRight, armJoin),
          capsuleDistance(px, py, armJoin, stemEnd),
        ) - strokeHalfWidth;
      const glyphAlpha = coverage(glyphDistance);
      if (glyphAlpha > 0) {
        r += (GLYPH_COLOR[0] - r) * glyphAlpha;
        g += (GLYPH_COLOR[1] - g) * glyphAlpha;
        b += (GLYPH_COLOR[2] - b) * glyphAlpha;
      }

      const offset = (y * size + x) * 4;
      rgba[offset] = Math.round(r);
      rgba[offset + 1] = Math.round(g);
      rgba[offset + 2] = Math.round(b);
      rgba[offset + 3] = Math.round(backgroundAlpha * 255);
    }
  }
  return rgba;
}

// ── 最小 PNG 编码器（8-bit RGBA + zlib）────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(size, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // color type: RGBA
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    signature,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── ICO / ICNS 容器 ───────────────────────────────────────────────────
function buildIco(pngBySize) {
  const entries = [...pngBySize.entries()].sort((a, b) => a[0] - b[0]);
  const directory = Buffer.alloc(6 + entries.length * 16);
  directory.writeUInt16LE(0, 0); // reserved
  directory.writeUInt16LE(1, 2); // type: icon
  directory.writeUInt16LE(entries.length, 4);

  let offset = directory.length;
  entries.forEach(([size, png], index) => {
    const base = 6 + index * 16;
    // 256 在 ICO 目录里用 0 表示。
    directory.writeUInt8(size >= 256 ? 0 : size, base);
    directory.writeUInt8(size >= 256 ? 0 : size, base + 1);
    directory.writeUInt8(0, base + 2); // 调色板数量
    directory.writeUInt8(0, base + 3); // reserved
    directory.writeUInt16LE(1, base + 4); // color planes
    directory.writeUInt16LE(32, base + 6); // bits per pixel
    directory.writeUInt32LE(png.length, base + 8);
    directory.writeUInt32LE(offset, base + 12);
    offset += png.length;
  });

  return Buffer.concat([directory, ...entries.map(([, png]) => png)]);
}

const ICNS_TYPES = [
  [32, "ic11"],
  [64, "ic12"],
  [128, "ic07"],
  [256, "ic08"],
  [512, "ic09"],
  [1024, "ic10"],
];

// ── 输出目标 ──────────────────────────────────────────────────────────
const LINUX_ICON_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

const targets = [
  ...LINUX_ICON_SIZES.map((size) => ({
    path: `packages/desktop/build/icons/${size}x${size}.png`,
    size,
  })),
  ...LINUX_ICON_SIZES.map((size) => ({ path: `public/logo/icons/${size}x${size}.png`, size })),
  { path: "packages/desktop/build/icon.png", size: 1024 },
  { path: "packages/desktop/build/icon_windows.png", size: 1024 },
  { path: "packages/desktop/build/icon_installer.png", size: 1024 },
  { path: "public/icon_512@2x.png", size: 1024 },
];

const pngCache = new Map();
function pngFor(size) {
  let png = pngCache.get(size);
  if (!png) {
    png = encodePng(size, renderRgba(size));
    pngCache.set(size, png);
  }
  return png;
}

for (const target of targets) {
  const full = join(repoRoot, target.path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, pngFor(target.size));
}

const ico = buildIco(new Map([16, 24, 32, 48, 64, 128, 256].map((s) => [s, pngFor(s)])));
for (const path of [
  "packages/desktop/build/icon.ico",
  "packages/desktop/build/icon_installer.ico",
  "public/logo/icons/icon.ico",
]) {
  await writeFile(join(repoRoot, path), ico);
}

const smallIco = buildIco(new Map([16, 32, 48].map((s) => [s, pngFor(s)])));
await writeFile(join(repoRoot, "packages/web/public/favicon.ico"), smallIco);

const icns = new Icns();
for (const [size, osType] of ICNS_TYPES) {
  icns.append(IcnsImage.fromPNG(pngFor(size), osType));
}
for (const path of [
  "packages/desktop/build/icon.icns",
  "packages/desktop/build/icon_installer.icns",
  "public/logo/icons/icon.icns",
]) {
  await writeFile(join(repoRoot, path), icns.data);
}

console.log(`placeholder icons written: ${targets.length} PNG + 4 ICO + 3 ICNS`);
console.log(`favicon 32x32 base64 (for inline <link>):`);
console.log(pngFor(32).toString("base64"));
