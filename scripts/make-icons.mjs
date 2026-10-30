// 生成扩展图标（纯 Node，无第三方依赖）
// 用法：node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

const outDir = fileURLToPath(new URL('../public/icons/', import.meta.url));
mkdirSync(outDir, { recursive: true });

/* ---------- PNG 编码 ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // 每行前置一个 filter byte(0)
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- 绘制 ---------- */
// 圆角矩形有符号距离场（像素单位，负值在内）
function sdRoundRect(px, py, cx, cy, halfW, halfH, r) {
  const qx = Math.abs(px - cx) - (halfW - r);
  const qy = Math.abs(py - cy) - (halfH - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

// 用距离场换算覆盖率做抗锯齿
const coverage = (d) => Math.min(1, Math.max(0, 0.5 - d));

const lerp = (a, b, t) => a + (b - a) * t;

function draw(size) {
  const buf = Buffer.alloc(size * size * 4);
  const S = size;

  // 背景渐变端点
  const c1 = [0x63, 0x66, 0xf1]; // indigo-500
  const c2 = [0x8b, 0x5c, 0xf6]; // violet-500

  // 三条横条（归一化坐标）
  const bars = [
    { y: 0.30, w: 0.60, h: 0.105, a: 0.96 },
    { y: 0.48, w: 0.60, h: 0.105, a: 0.74 },
    { y: 0.66, w: 0.38, h: 0.105, a: 0.52 },
  ].map((b) => ({
    cy: b.y * S,
    cx: (0.5 - 0.30) * S + (b.w * S) / 2,
    halfW: (b.w * S) / 2,
    halfH: (b.h * S) / 2,
    r: (b.h * S) / 2,
    a: b.a,
  }));

  const bgHalf = S / 2;
  const bgR = S * 0.225;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const i = (y * S + x) * 4;

      // 背景
      const dBg = sdRoundRect(px, py, bgHalf, bgHalf, bgHalf, bgHalf, bgR);
      const bgCov = coverage(dBg);
      if (bgCov <= 0) {
        buf[i + 3] = 0;
        continue;
      }

      const t = Math.min(1, Math.max(0, (px + py) / (2 * S)));
      let r = lerp(c1[0], c2[0], t);
      let g = lerp(c1[1], c2[1], t);
      let b = lerp(c1[2], c2[2], t);

      // 叠加白色横条
      for (const bar of bars) {
        const d = sdRoundRect(px, py, bar.cx, bar.cy, bar.halfW, bar.halfH, bar.r);
        const cov = coverage(d) * bar.a;
        if (cov > 0) {
          r = lerp(r, 255, cov);
          g = lerp(g, 255, cov);
          b = lerp(b, 255, cov);
        }
      }

      buf[i] = Math.round(r);
      buf[i + 1] = Math.round(g);
      buf[i + 2] = Math.round(b);
      buf[i + 3] = Math.round(bgCov * 255);
    }
  }

  return encodePng(S, buf);
}

for (const size of [16, 32, 48, 128]) {
  const png = draw(size);
  writeFileSync(`${outDir}icon${size}.png`, png);
  console.log(`icon${size}.png  ${png.length} bytes`);
}
