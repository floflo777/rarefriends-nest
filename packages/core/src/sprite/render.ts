/**
 * 1-bit LCD renderer, no DOM. A buffer is a row-major Uint8Array of 0/1 pixels with
 * its dimensions; `renderLcd` composes declarative layers into one, and
 * `lcdToImageData` turns it into RGBA for a canvas `putImageData` in the web app.
 * Every primitive clips to the buffer, so out-of-bounds coordinates are safe.
 */
import type { PetFrame } from "../types.js";
import { frameToRows } from "./decode.js";
import { GLYPH_ADVANCE, GLYPH_HEIGHT, GLYPH_WIDTH, glyphFor } from "./font5x7.js";
import { ICONS, ICON_SIZE, type IconName } from "./icons.js";

export interface LcdSize {
  width: number;
  height: number;
}

/** The handheld's screen. */
export const LCD_SIZE: LcdSize = { width: 96, height: 64 };

export interface LcdBuffer extends LcdSize {
  /** Row-major, one byte per pixel, 0 = off, 1 = on. */
  data: Uint8Array;
}

export function createLcd(size: LcdSize = LCD_SIZE): LcdBuffer {
  const width = Math.max(0, Math.floor(size.width));
  const height = Math.max(0, Math.floor(size.height));
  return { width, height, data: new Uint8Array(width * height) };
}

/** Views an existing 0/1 pixel array as a buffer. Throws if the length does not match. */
export function wrapLcd(data: Uint8Array, size: LcdSize = LCD_SIZE): LcdBuffer {
  if (data.length !== size.width * size.height) {
    throw new RangeError(`wrapLcd: ${data.length} bytes do not fit ${size.width}x${size.height}`);
  }
  return { width: size.width, height: size.height, data };
}

export function clearLcd(buffer: LcdBuffer, on = false): void {
  buffer.data.fill(on ? 1 : 0);
}

export function setPixel(buffer: LcdBuffer, x: number, y: number, on = true): void {
  if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) return;
  buffer.data[y * buffer.width + x] = on ? 1 : 0;
}

export function getPixel(buffer: LcdBuffer, x: number, y: number): 0 | 1 {
  if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) return 0;
  return buffer.data[y * buffer.width + x] === 1 ? 1 : 0;
}

export function fillRect(buffer: LcdBuffer, x: number, y: number, w: number, h: number, on = true): void {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(buffer.width, Math.floor(x + w));
  const y1 = Math.min(buffer.height, Math.floor(y + h));
  const v = on ? 1 : 0;
  for (let yy = y0; yy < y1; yy++) buffer.data.fill(v, yy * buffer.width + x0, yy * buffer.width + x1);
}

/** 1 px outline of the rectangle. */
export function strokeRect(buffer: LcdBuffer, x: number, y: number, w: number, h: number, on = true): void {
  if (w <= 0 || h <= 0) return;
  fillRect(buffer, x, y, w, 1, on);
  fillRect(buffer, x, y + h - 1, w, 1, on);
  fillRect(buffer, x, y, 1, h, on);
  fillRect(buffer, x + w - 1, y, 1, h, on);
}

/** Draws rows of booleans (any bitmap) at (x, y), each lit pixel as a scale x scale block. */
export function blitRows(
  buffer: LcdBuffer,
  rows: readonly (readonly boolean[])[],
  x: number,
  y: number,
  scale = 1,
  on = true,
): void {
  const s = Math.max(1, Math.floor(scale));
  for (let ry = 0; ry < rows.length; ry++) {
    const row = rows[ry];
    if (row === undefined) continue;
    for (let rx = 0; rx < row.length; rx++) {
      if (!row[rx]) continue;
      if (s === 1) setPixel(buffer, x + rx, y + ry, on);
      else fillRect(buffer, x + rx * s, y + ry * s, s, s, on);
    }
  }
}

/** Draws a 16x16 frame with its top-left corner at (x, y). */
export function blitFrame(buffer: LcdBuffer, frame: PetFrame, x: number, y: number, scale = 1, on = true): void {
  blitRows(buffer, frameToRows(frame), x, y, scale, on);
}

/** Draws a '#'-pattern bitmap (font glyph or icon) at (x, y). */
function blitPattern(buffer: LcdBuffer, pattern: readonly string[], x: number, y: number, on = true): void {
  for (let ry = 0; ry < pattern.length; ry++) {
    const line = pattern[ry];
    if (line === undefined) continue;
    for (let rx = 0; rx < line.length; rx++) if (line[rx] === "#") setPixel(buffer, x + rx, y + ry, on);
  }
}

/** Width in pixels of a line of text (without the trailing gap). */
export function textWidth5x7(text: string): number {
  return text.length === 0 ? 0 : text.length * GLYPH_ADVANCE - 1;
}

export const TEXT_HEIGHT_5X7 = GLYPH_HEIGHT;

/** Draws text at (x, y) with the built-in 5x7 font; returns the x after the last glyph. */
export function drawText5x7(buffer: LcdBuffer, text: string, x: number, y: number, on = true): number {
  let cx = x;
  for (const ch of text) {
    blitPattern(buffer, glyphFor(ch), cx, y, on);
    cx += GLYPH_ADVANCE;
  }
  return cx;
}

/** Splits text into lines no wider than maxWidth px, breaking on spaces (hard-cutting long words). */
export function wrapText5x7(text: string, maxWidth: number): string[] {
  const maxChars = Math.max(1, Math.floor((maxWidth + 1) / GLYPH_ADVANCE));
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter((w) => w.length > 0)) {
    let w = word;
    while (w.length > maxChars) {
      if (current.length > 0) {
        lines.push(current);
        current = "";
      }
      lines.push(w.slice(0, maxChars));
      w = w.slice(maxChars);
    }
    const candidate = current.length === 0 ? w : `${current} ${w}`;
    if (candidate.length <= maxChars) current = candidate;
    else {
      lines.push(current);
      current = w;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

/** Outlined gauge filled from the left by fill01 in [0, 1]. */
export function drawBar(buffer: LcdBuffer, x: number, y: number, w: number, h: number, fill01: number): void {
  if (w <= 0 || h <= 0) return;
  const f = Number.isFinite(fill01) ? Math.min(1, Math.max(0, fill01)) : 0;
  if (w < 3 || h < 3) {
    fillRect(buffer, x, y, Math.round(w * f), h);
    return;
  }
  strokeRect(buffer, x, y, w, h);
  const inner = w - 2;
  const filled = Math.round(inner * f);
  if (filled > 0) fillRect(buffer, x + 1, y + 1, filled, h - 2);
}

/** Draws one of the built-in 8x8 icons with its top-left corner at (x, y). */
export function drawIcon(buffer: LcdBuffer, name: IconName, x: number, y: number, on = true): void {
  blitPattern(buffer, ICONS[name], x, y, on);
}

export { ICON_SIZE, GLYPH_WIDTH, GLYPH_HEIGHT, GLYPH_ADVANCE };

/** Declarative layers composed in order by renderLcd. */
export type LcdLayer =
  | { kind: "clear"; on?: boolean }
  | { kind: "frame"; frame: PetFrame; x: number; y: number; scale?: number; on?: boolean }
  | { kind: "rows"; rows: readonly (readonly boolean[])[]; x: number; y: number; scale?: number; on?: boolean }
  | { kind: "text"; text: string; x: number; y: number; on?: boolean }
  | { kind: "bar"; x: number; y: number; w: number; h: number; fill: number }
  | { kind: "icon"; name: IconName; x: number; y: number; on?: boolean }
  | { kind: "rect"; x: number; y: number; w: number; h: number; filled?: boolean; on?: boolean }
  | { kind: "pixels"; points: readonly { x: number; y: number }[]; on?: boolean };

export function drawLayer(buffer: LcdBuffer, layer: LcdLayer): void {
  switch (layer.kind) {
    case "clear":
      clearLcd(buffer, layer.on ?? false);
      return;
    case "frame":
      blitFrame(buffer, layer.frame, layer.x, layer.y, layer.scale ?? 1, layer.on ?? true);
      return;
    case "rows":
      blitRows(buffer, layer.rows, layer.x, layer.y, layer.scale ?? 1, layer.on ?? true);
      return;
    case "text":
      drawText5x7(buffer, layer.text, layer.x, layer.y, layer.on ?? true);
      return;
    case "bar":
      drawBar(buffer, layer.x, layer.y, layer.w, layer.h, layer.fill);
      return;
    case "icon":
      drawIcon(buffer, layer.name, layer.x, layer.y, layer.on ?? true);
      return;
    case "rect":
      if (layer.filled ?? false) fillRect(buffer, layer.x, layer.y, layer.w, layer.h, layer.on ?? true);
      else strokeRect(buffer, layer.x, layer.y, layer.w, layer.h, layer.on ?? true);
      return;
    case "pixels":
      for (const p of layer.points) setPixel(buffer, p.x, p.y, layer.on ?? true);
      return;
  }
}

/** Composes layers into a fresh buffer of the given size. */
export function renderLcdBuffer(size: LcdSize, layers: readonly LcdLayer[]): LcdBuffer {
  const buffer = createLcd(size);
  for (const layer of layers) drawLayer(buffer, layer);
  return buffer;
}

/** Composes layers and returns the raw 0/1 pixel array (row-major, width*height bytes). */
export function renderLcd(size: LcdSize, layers: readonly LcdLayer[]): Uint8Array {
  return renderLcdBuffer(size, layers).data;
}

export type Rgba = readonly [r: number, g: number, b: number, a: number];

export interface LcdPalette {
  on: Rgba;
  off: Rgba;
}

/** Classic green monochrome LCD. */
export const LCD_PALETTE: LcdPalette = { on: [15, 56, 15, 255], off: [155, 188, 15, 255] };
export const INK_PALETTE: LcdPalette = { on: [20, 20, 20, 255], off: [235, 235, 225, 255] };

/** Plain ImageData-shaped object (no DOM types) for `ctx.putImageData(new ImageData(data, w, h))`. */
export interface LcdImageData {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export function lcdToImageData(
  buffer: LcdBuffer | Uint8Array,
  palette: LcdPalette = LCD_PALETTE,
  size: LcdSize = LCD_SIZE,
): LcdImageData {
  const lcd = buffer instanceof Uint8Array ? wrapLcd(buffer, size) : buffer;
  const out = new Uint8ClampedArray(lcd.width * lcd.height * 4);
  for (let i = 0; i < lcd.data.length; i++) {
    const c = lcd.data[i] === 1 ? palette.on : palette.off;
    out[i * 4] = c[0];
    out[i * 4 + 1] = c[1];
    out[i * 4 + 2] = c[2];
    out[i * 4 + 3] = c[3];
  }
  return { width: lcd.width, height: lcd.height, data: out };
}

/** Text picture of a buffer, for tests and the CLI. */
export function lcdToAscii(buffer: LcdBuffer, on = "#", off = "."): string {
  const lines: string[] = [];
  for (let y = 0; y < buffer.height; y++) {
    let line = "";
    for (let x = 0; x < buffer.width; x++) line += buffer.data[y * buffer.width + x] === 1 ? on : off;
    lines.push(line);
  }
  return lines.join("\n");
}
