/**
 * 1-bit framebuffer for the 96x64 LCD. Every screen composes into a Uint8Array of 0/1
 * pixels; the canvas component only blits it. Core's sprite renderer can hand a
 * Uint8Array of the same shape to `Lcd` directly.
 */
import type { PetFrame } from "@nest/core";
import { CHAR_ADVANCE, GLYPH_H, GLYPH_W, glyphRows, textWidth } from "./font.js";
import { FRAME_SIZE, framePixel } from "./sprite.js";

export const LCD_W = 96;
export const LCD_H = 64;

export type FrameBuffer = Uint8Array;

export function createFrameBuffer(): FrameBuffer {
  return new Uint8Array(LCD_W * LCD_H);
}

export function setPixel(fb: FrameBuffer, x: number, y: number, on = true): void {
  if (x < 0 || y < 0 || x >= LCD_W || y >= LCD_H) return;
  fb[y * LCD_W + x] = on ? 1 : 0;
}

export function getPixel(fb: FrameBuffer, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= LCD_W || y >= LCD_H) return false;
  return fb[y * LCD_W + x] === 1;
}

export function fillRect(fb: FrameBuffer, x: number, y: number, w: number, h: number, on = true): void {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) setPixel(fb, i, j, on);
}

export function strokeRect(fb: FrameBuffer, x: number, y: number, w: number, h: number): void {
  fillRect(fb, x, y, w, 1);
  fillRect(fb, x, y + h - 1, w, 1);
  fillRect(fb, x, y, 1, h);
  fillRect(fb, x + w - 1, y, 1, h);
}

export function invertRect(fb: FrameBuffer, x: number, y: number, w: number, h: number): void {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) setPixel(fb, i, j, !getPixel(fb, i, j));
}

/** Draw text with the 3x5 font. Returns the x after the last glyph. */
export function drawText(fb: FrameBuffer, x: number, y: number, text: string): number {
  let cx = x;
  for (const ch of text) {
    const rows = glyphRows(ch);
    for (let j = 0; j < GLYPH_H; j++) {
      const row = rows[j] ?? "";
      for (let i = 0; i < GLYPH_W; i++) if (row[i] === "#") setPixel(fb, cx + i, y + j);
    }
    cx += CHAR_ADVANCE;
  }
  return cx;
}

export function drawTextRight(fb: FrameBuffer, right: number, y: number, text: string): void {
  drawText(fb, right - textWidth(text), y, text);
}

export function drawTextCentered(fb: FrameBuffer, y: number, text: string, x0 = 0, w = LCD_W): void {
  drawText(fb, x0 + Math.floor((w - textWidth(text)) / 2), y, text);
}

/** Truncate to at most `cols` characters. */
export function fit(text: string, cols: number): string {
  return text.length <= cols ? text : text.slice(0, cols);
}

/** Label left, value right on one 24-column line. */
export function drawRow(fb: FrameBuffer, y: number, label: string, value: string, x0 = 1, right = LCD_W - 2): void {
  drawText(fb, x0, y, label);
  drawTextRight(fb, right, y, value);
}

/** Horizontal bar with a 1 px border; `ratio` in [0, 1]. */
export function drawBar(fb: FrameBuffer, x: number, y: number, w: number, h: number, ratio: number): void {
  strokeRect(fb, x, y, w, h);
  const inner = Math.round(Math.max(0, Math.min(1, ratio)) * (w - 2));
  fillRect(fb, x + 1, y + 1, inner, h - 2);
}

/** Row-string icon ('#' = on). */
export function drawIcon(fb: FrameBuffer, x: number, y: number, rows: readonly string[]): void {
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) if (row[i] === "#") setPixel(fb, x + i, y + j);
  });
}

/** 16x16 pet frame scaled by an integer factor. */
export function drawPetFrame(fb: FrameBuffer, x: number, y: number, frame: PetFrame, scale = 3): void {
  for (let j = 0; j < FRAME_SIZE; j++) {
    for (let i = 0; i < FRAME_SIZE; i++) {
      if (framePixel(frame, i, j)) fillRect(fb, x + i * scale, y + j * scale, scale, scale);
    }
  }
}

/** Debug/test helper: the buffer as 64 strings of '#'/'.'. */
export function toRows(fb: FrameBuffer): string[] {
  const rows: string[] = [];
  for (let y = 0; y < LCD_H; y++) {
    let s = "";
    for (let x = 0; x < LCD_W; x++) s += fb[y * LCD_W + x] ? "#" : ".";
    rows.push(s);
  }
  return rows;
}
