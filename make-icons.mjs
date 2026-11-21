/**
 * Generates the extension's PNG icons with no dependencies (Node + zlib).
 * The mark: a full-bleed rounded square in the Osmosis purple -> magenta
 * gradient (the popup's own accent colors) with a white eye, for "read-only
 * viewing". Run with `npm run icons`; the PNGs are committed and the build
 * copies icons/ into dist/.
 */
import zlib from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const C0 = [0x7d, 0x5c, 0xff]; // --accent purple
const C1 = [0xe2, 0x4b, 0xc4]; // magenta
const WHITE = [255, 255, 255];
const PUPIL = [0x2e, 0x10, 0x65]; // deep indigo

const lerp = (a, b, t) => a + (b - a) * t;

function sampleColor(x, y, N) {
  const half = N / 2;
  const R = 0.22 * N; // corner radius
  const px = x - half;
  const py = y - half;
  // Signed distance to the rounded square; > 0 is outside (transparent).
  const qx = Math.abs(px) - (half - R);
  const qy = Math.abs(py) - (half - R);
  const d =
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
    Math.min(Math.max(qx, qy), 0) -
    R;
  if (d > 0) return [0, 0, 0, 0];

  // Diagonal brand gradient.
  const t = (x + y) / (2 * N);
  let r = lerp(C0[0], C1[0], t);
  let g = lerp(C0[1], C1[1], t);
  let b = lerp(C0[2], C1[2], t);

  // White eyeball (wide ellipse).
  const a = 0.34 * N;
  const bb = 0.225 * N;
  if ((px * px) / (a * a) + (py * py) / (bb * bb) <= 1) {
    [r, g, b] = WHITE;
  }
  // Pupil.
  const pr = 0.12 * N;
  if (px * px + py * py <= pr * pr) {
    [r, g, b] = PUPIL;
  }
  // Catchlight (only meaningful on larger sizes).
  const cx = px - 0.045 * N;
  const cy = py + 0.045 * N;
  if (cx * cx + cy * cy <= (0.03 * N) * (0.03 * N)) {
    [r, g, b] = WHITE;
  }
  return [r, g, b, 255];
}

function render(N, s) {
  const out = Buffer.alloc(N * N * 4);
  for (let iy = 0; iy < N; iy++) {
    for (let ix = 0; ix < N; ix++) {
      let sr = 0, sg = 0, sb = 0, sa = 0;
      for (let yy = 0; yy < s; yy++) {
        for (let xx = 0; xx < s; xx++) {
          const [r, g, b, aa] = sampleColor(
            ix + (xx + 0.5) / s,
            iy + (yy + 0.5) / s,
            N
          );
          const a = aa / 255;
          sr += r * a; sg += g * a; sb += b * a; sa += a; // premultiplied
        }
      }
      const idx = (iy * N + ix) * 4;
      if (sa > 0) {
        out[idx] = Math.round(sr / sa);
        out[idx + 1] = Math.round(sg / sa);
        out[idx + 2] = Math.round(sb / sa);
        out[idx + 3] = Math.round((sa / (s * s)) * 255);
      }
    }
  }
  return out;
}

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (~c) >>> 0;
};
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(N, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(N, 0);
  ihdr.writeUInt32BE(N, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(N * (N * 4 + 1));
  for (let y = 0; y < N; y++) {
    raw[y * (N * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, y * N * 4 + N * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("icons", { recursive: true });
for (const N of [16, 32, 48, 128]) {
  writeFileSync(`icons/icon${N}.png`, encodePNG(N, render(N, N <= 32 ? 5 : 4)));
  console.log(`icons/icon${N}.png`);
}
