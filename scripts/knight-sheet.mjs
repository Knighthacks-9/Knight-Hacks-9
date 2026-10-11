// Rebuilds the knight's sprite sheet in the NPC layout (src/shared/npcSprites.ts):
// 256x256, 4x4 frames of 64x64, rows facing down, left, right, up.
//
//   npm run sprites:knight
//
// Reads the large source drawing, scripts/art/knight-source.png (a loose 4x4
// grid on a transparent background, both side rows facing right), and writes
// public/assets/npcs/knight.png. Each figure is found by the empty gaps
// between them, scaled to civilian height, anchored on its helmet and feet so
// the walk cycle doesn't jitter, and box-filtered down with crisp edges. The
// left row is the right-facing row mirrored. No dependencies: PNGs are read
// and written with node:zlib.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const root = fileURLToPath(new URL("..", import.meta.url));
const SOURCE = `${root}scripts/art/knight-source.png`;
const OUTPUT = `${root}public/assets/npcs/knight.png`;

const FRAME = 64;
const SHEET_SIZE = FRAME * 4;
/** Tallest frame's height in the sheet; the civilian sheets are 46 to 52. */
const FIGURE_HEIGHT = 50;
/** Bottom edge of the feet in each frame, as on the civilian sheets. */
const FEET_LINE = 62;
/** Source alpha that counts as part of a figure. */
const SOLID = 16;
/** Point samples per output pixel, per axis. */
const SAMPLES = 6;

/** Decodes an 8-bit RGBA, non-interlaced PNG. */
function readPng(path) {
  const file = readFileSync(path);
  let pos = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (pos < file.length) {
    const length = file.readUInt32BE(pos);
    const type = file.toString("ascii", pos + 4, pos + 8);
    const data = file.subarray(pos + 8, pos + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) {
        throw new Error(`${path}: expected an 8-bit RGBA, non-interlaced PNG.`);
      }
    } else if (type === "IDAT") idat.push(data);
    pos += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x;
      const a = x >= 4 ? pixels[i - 4] : 0;
      const b = y > 0 ? pixels[i - stride] : 0;
      const c = x >= 4 && y > 0 ? pixels[i - stride - 4] : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixels[i] = (raw[line + x] + predictor) & 255;
    }
  }
  return { width, height, pixels };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** Encodes RGBA pixels as a PNG. */
function writePng(path, width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

const source = readPng(SOURCE);
const alphaAt = (x, y) => source.pixels[(y * source.width + x) * 4 + 3];

/** Runs of non-empty rows (or columns): where the figures are. */
function bands(length, filled) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= length; i++) {
    const on = i < length && filled(i);
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      out.push([start, i]);
      start = -1;
    }
  }
  return out;
}

const rowBands = bands(source.height, (y) => {
  for (let x = 0; x < source.width; x++) if (alphaAt(x, y) > SOLID) return true;
  return false;
});
const colBands = bands(source.width, (x) => {
  for (let y = 0; y < source.height; y++)
    if (alphaAt(x, y) > SOLID) return true;
  return false;
});
if (rowBands.length !== 4 || colBands.length !== 4) {
  throw new Error(
    `Expected a 4x4 grid of figures, found ${rowBands.length} rows and ${colBands.length} columns.`,
  );
}

/** Each figure's box, and its anchor: helmet centre x and feet y. */
const figures = rowBands.map(([y0, y1]) =>
  colBands.map(([x0, x1]) => {
    let top = Infinity;
    let bottom = -1;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (alphaAt(x, y) > SOLID) {
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
    }
    // The helmet (top 35%) barely moves while walking, unlike arms and legs.
    const helmetEnd = top + (bottom - top) * 0.35;
    let sum = 0;
    let weight = 0;
    for (let y = top; y < helmetEnd; y++) {
      for (let x = x0; x < x1; x++) {
        const a = alphaAt(x, y);
        sum += x * a;
        weight += a;
      }
    }
    return { x0, x1, y0, y1, top, bottom, centerX: sum / weight };
  }),
);

const tallest = Math.max(...figures.flat().map((f) => f.bottom - f.top + 1));
const scale = FIGURE_HEIGHT / tallest;

/** Draws one figure into the sheet's frame (col, row), optionally mirrored. */
function drawFrame(sheet, figure, col, row, mirror) {
  const step = 1 / scale / SAMPLES;
  for (let v = 0; v < FRAME; v++) {
    for (let u = 0; u < FRAME; u++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const du = (u - FRAME / 2) / scale + (sx + 0.5) * step;
          const x = Math.floor(figure.centerX + (mirror ? -du : du));
          const y = Math.floor(
            figure.bottom + 1 + (v - FEET_LINE) / scale + (sy + 0.5) * step,
          );
          if (
            x < figure.x0 ||
            x >= figure.x1 ||
            y < figure.y0 ||
            y >= figure.y1
          )
            continue;
          const i = (y * source.width + x) * 4;
          const alpha = source.pixels[i + 3] / 255;
          r += source.pixels[i] * alpha;
          g += source.pixels[i + 1] * alpha;
          b += source.pixels[i + 2] * alpha;
          a += alpha;
        }
      }
      // Crisp pixel-art edges: a pixel is either solid or empty.
      if (a / (SAMPLES * SAMPLES) < 0.5) continue;
      const o = ((row * FRAME + v) * SHEET_SIZE + col * FRAME + u) * 4;
      sheet[o] = Math.round(r / a);
      sheet[o + 1] = Math.round(g / a);
      sheet[o + 2] = Math.round(b / a);
      sheet[o + 3] = 255;
    }
  }
}

// Source rows: down, right, right, up. Sheet rows: down, left, right, up.
const LAYOUT = [
  { from: 0, mirror: false },
  { from: 1, mirror: true },
  { from: 2, mirror: false },
  { from: 3, mirror: false },
];
const sheet = Buffer.alloc(SHEET_SIZE * SHEET_SIZE * 4);
LAYOUT.forEach(({ from, mirror }, row) => {
  figures[from].forEach((figure, col) =>
    drawFrame(sheet, figure, col, row, mirror),
  );
});
writePng(OUTPUT, SHEET_SIZE, SHEET_SIZE, sheet);
console.log(
  `Wrote ${OUTPUT} (${SHEET_SIZE}x${SHEET_SIZE}, scale ${scale.toFixed(3)} from a ${tallest}px figure).`,
);
