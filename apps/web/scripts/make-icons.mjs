// Draws the Nest icon (an egg in a nest) as SVG and as 192/512 PNGs using only Node.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const out = resolve(dirname(fileURLToPath(import.meta.url)), "../public/icons");
mkdirSync(out, { recursive: true });

const BG = [0x31, 0x40, 0x1f];
const EGG = [0xc5, 0xd8, 0xa4];
const NEST = [0x8a, 0x5a, 0x2b];
const NEST_DARK = [0x4f, 0x31, 0x16];

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect width="64" height="64" rx="14" fill="#31401f"/>
<ellipse cx="32" cy="46" rx="24" ry="10" fill="#4f3116"/>
<ellipse cx="32" cy="43" rx="22" ry="8" fill="#8a5a2b"/>
<path d="M32 12c-8 0-14 12-14 21a14 14 0 0 0 28 0c0-9-6-21-14-21z" fill="#c5d8a4"/>
<ellipse cx="32" cy="46" rx="20" ry="5" fill="#8a5a2b"/>
</svg>
`;
writeFileSync(resolve(out, "icon.svg"), svg);

function pixel(u, v) {
  // u, v in [0, 1). Same shapes as the SVG, evaluated analytically.
  const x = u * 64;
  const y = v * 64;
  // Rounded square mask.
  const r = 14;
  const cx = Math.min(Math.max(x, r), 64 - r);
  const cy = Math.min(Math.max(y, r), 64 - r);
  if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) return null;
  const inEllipse = (ex, ey, rx, ry) => ((x - ex) / rx) ** 2 + ((y - ey) / ry) ** 2 <= 1;
  if (inEllipse(32, 46, 20, 5)) return NEST;
  // Egg: ellipse with a narrower top.
  const eyc = 33;
  const ry = y < eyc ? 21 : 14;
  const rx = 14 * (y < eyc ? 1 - 0.35 * ((eyc - y) / 21) ** 2 : 1);
  if (((x - 32) / rx) ** 2 + ((y - eyc) / ry) ** 2 <= 1) return EGG;
  if (inEllipse(32, 43, 22, 8)) return NEST;
  if (inEllipse(32, 46, 24, 10)) return NEST_DARK;
  return BG;
}

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      // 2x2 supersampling for smoother edges.
      let acc = [0, 0, 0, 0];
      for (const [dx, dy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const p = pixel((x + dx) / size, (y + dy) / size);
        if (p) acc = [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2], acc[3] + 255];
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const n = acc[3] / 255 || 1;
      raw[o] = acc[0] / n;
      raw[o + 1] = acc[1] / n;
      raw[o + 2] = acc[2] / n;
      raw[o + 3] = acc[3] / 4;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) writeFileSync(resolve(out, `icon-${size}.png`), png(size));
console.log("icons written to", out);
