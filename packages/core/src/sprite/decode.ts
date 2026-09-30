/**
 * Decoding of the on-chain sprites from the families registry.
 *
 * `frames(family, seed)` returns 64 uint256 words. Each word is a 16x16 1-bit bitmap:
 * bit index (y*16 + x) set means the pixel is on, y = 0 is the TOP row and x = 0 the
 * LEFT column. Frames 0..31 are the idle clip, 32..63 the walk clip. Genesis portraits
 * (`portrait(family, seed)`) are one word whose low 64 bits hold an 8x8 bitmap with the
 * same row-major convention.
 *
 * Pure functions, no I/O.
 */
import type { PetFrame, Sprite } from "../types.js";

export const FRAME_SIZE = 16;
export const FRAME_COUNT = 64;
export const IDLE_CLIP_START = 0;
export const WALK_CLIP_START = 32;
export const PORTRAIT_SIZE = 8;

const UINT256_MAX = (1n << 256n) - 1n;

/** Wraps the 64 registry words into a Sprite. Throws RangeError on bad input. */
export function decodeFrames(words: readonly bigint[]): Sprite {
  if (words.length !== FRAME_COUNT) {
    throw new RangeError(`decodeFrames: expected ${FRAME_COUNT} words, got ${words.length}`);
  }
  const frames: PetFrame[] = words.map((bits, i) => {
    if (typeof bits !== "bigint" || bits < 0n || bits > UINT256_MAX) {
      throw new RangeError(`decodeFrames: word ${i} is not a uint256`);
    }
    return { bits };
  });
  return {
    frames,
    idle: frames.slice(IDLE_CLIP_START, WALK_CLIP_START),
    walk: frames.slice(WALK_CLIP_START, FRAME_COUNT),
  };
}

/** Pixel (x, y) of a 16x16 frame; out-of-range coordinates read as off. */
export function pixelAt(frame: PetFrame, x: number, y: number): boolean {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= FRAME_SIZE || y >= FRAME_SIZE) return false;
  return ((frame.bits >> BigInt(y * FRAME_SIZE + x)) & 1n) === 1n;
}

/** Decodes a square row-major bitmap of `size` pixels per side into rows (top first). */
function wordToRows(bits: bigint, size: number): boolean[][] {
  const rows: boolean[][] = [];
  for (let y = 0; y < size; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < size; x++) row.push(((bits >> BigInt(y * size + x)) & 1n) === 1n);
    rows.push(row);
  }
  return rows;
}

/** 16 rows of 16 booleans, rows[0] is the top row, rows[y][0] the left pixel. */
export function frameToRows(frame: PetFrame): boolean[][] {
  return wordToRows(frame.bits, FRAME_SIZE);
}

/** The 8x8 Genesis portrait held in the low 64 bits of the registry word. */
export function decodePortrait8(word: bigint): boolean[][] {
  return wordToRows(word & ((1n << 64n) - 1n), PORTRAIT_SIZE);
}

/** Rows to a text picture, one line per row, no trailing newline. */
export function rowsToAscii(rows: readonly (readonly boolean[])[], on = "#", off = "."): string {
  return rows.map((row) => row.map((p) => (p ? on : off)).join("")).join("\n");
}

export function frameToAscii(frame: PetFrame, on = "#", off = "."): string {
  return rowsToAscii(frameToRows(frame), on, off);
}

/** Inverse of frameToRows; rows must be 16 rows of 16. */
export function rowsToFrame(rows: readonly (readonly boolean[])[]): PetFrame {
  if (rows.length !== FRAME_SIZE) throw new RangeError(`rowsToFrame: expected ${FRAME_SIZE} rows, got ${rows.length}`);
  let bits = 0n;
  for (let y = 0; y < FRAME_SIZE; y++) {
    const row = rows[y];
    if (row === undefined || row.length !== FRAME_SIZE) {
      throw new RangeError(`rowsToFrame: row ${y} must have ${FRAME_SIZE} pixels`);
    }
    for (let x = 0; x < FRAME_SIZE; x++) if (row[x]) bits |= 1n << BigInt(y * FRAME_SIZE + x);
  }
  return { bits };
}

/**
 * Inverse of frameToAscii. Accepts surrounding blank lines and indentation; every
 * non-blank line must be exactly 16 characters, `on` marks a lit pixel, anything else
 * is off.
 */
export function asciiToFrame(ascii: string, on = "#"): PetFrame {
  const lines = ascii
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length !== FRAME_SIZE) throw new RangeError(`asciiToFrame: expected ${FRAME_SIZE} lines, got ${lines.length}`);
  const rows = lines.map((line, y) => {
    if (line.length !== FRAME_SIZE) throw new RangeError(`asciiToFrame: line ${y} has ${line.length} chars, expected ${FRAME_SIZE}`);
    return Array.from(line, (ch) => ch === on);
  });
  return rowsToFrame(rows);
}

/** Inclusive bounding box of the lit pixels of a frame. */
export interface FrameBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

/** Bounding box of lit pixels, or null for an empty frame. Used to centre a sprite. */
export function frameBounds(frame: PetFrame): FrameBounds | null {
  let minX = FRAME_SIZE;
  let minY = FRAME_SIZE;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < FRAME_SIZE; y++) {
    for (let x = 0; x < FRAME_SIZE; x++) {
      if (!pixelAt(frame, x, y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** One pixel that differs between two frames; `on` is the value in the second frame. */
export interface FramePixelDelta {
  x: number;
  y: number;
  on: boolean;
}

/** Pixels that differ between a and b, in row-major order. Empty when equal. */
export function frameDiff(a: PetFrame, b: PetFrame): FramePixelDelta[] {
  const changed = a.bits ^ b.bits;
  const out: FramePixelDelta[] = [];
  if (changed === 0n) return out;
  for (let i = 0; i < FRAME_SIZE * FRAME_SIZE; i++) {
    if (((changed >> BigInt(i)) & 1n) === 1n) {
      out.push({ x: i % FRAME_SIZE, y: Math.floor(i / FRAME_SIZE), on: ((b.bits >> BigInt(i)) & 1n) === 1n });
    }
  }
  return out;
}

export function frameEquals(a: PetFrame, b: PetFrame): boolean {
  return a.bits === b.bits;
}

/** Number of lit pixels. */
export function framePopCount(frame: PetFrame): number {
  let n = 0;
  let v = frame.bits;
  while (v > 0n) {
    n += Number(v & 1n);
    v >>= 1n;
  }
  return n;
}
