import { describe, expect, it } from "vitest";
import {
  asciiToFrame,
  decodeFrames,
  decodePortrait8,
  frameBounds,
  frameDiff,
  framePopCount,
  frameToAscii,
  frameToRows,
  pixelAt,
  rowsToFrame,
} from "../decode.js";

/** Friend 1969 (family 4 Asymmetry, seed 1969), frame 0, verified against the registry. */
export const FRIEND_1969_FRAME0 = [
  "................",
  "................",
  "................",
  "................",
  "................",
  "....#......#....",
  "....########....",
  "....#..##..#....",
  "....########....",
  ".....######.#...",
  ".....##..####...",
  ".....#######....",
  ".....######.....",
  ".....##..##.....",
  ".....##..##.....",
  "................",
].join("\n");

/** Builds the uint256 by hand (bit y*16+x, y = 0 top) so the test does not trust asciiToFrame. */
function wordFromAscii(ascii: string): bigint {
  let bits = 0n;
  ascii.split("\n").forEach((line, y) => {
    for (let x = 0; x < 16; x++) if (line[x] === "#") bits |= 1n << BigInt(y * 16 + x);
  });
  return bits;
}

describe("decodeFrames", () => {
  it("decodes the 1969 fixture to the exact ASCII picture", () => {
    const word = wordFromAscii(FRIEND_1969_FRAME0);
    const words = Array.from({ length: 64 }, (_, i) => (i === 0 ? word : 0n));
    const sprite = decodeFrames(words);
    expect(sprite.frames).toHaveLength(64);
    expect(sprite.idle).toHaveLength(32);
    expect(sprite.walk).toHaveLength(32);
    expect(sprite.idle[0]!.bits).toBe(word);
    expect(sprite.walk[0]).toBe(sprite.frames[32]);
    expect(frameToAscii(sprite.frames[0]!)).toBe(FRIEND_1969_FRAME0);
  });

  it("round-trips ascii -> frame -> ascii and rows -> frame", () => {
    const frame = asciiToFrame(FRIEND_1969_FRAME0);
    expect(frame.bits).toBe(wordFromAscii(FRIEND_1969_FRAME0));
    expect(frameToAscii(frame)).toBe(FRIEND_1969_FRAME0);
    expect(rowsToFrame(frameToRows(frame)).bits).toBe(frame.bits);
  });

  it("uses y = 0 as the top row and x = 0 as the left column", () => {
    const frame = { bits: 1n }; // bit 0 -> (0, 0)
    expect(pixelAt(frame, 0, 0)).toBe(true);
    expect(frameToRows(frame)[0]![0]).toBe(true);
    const bottomRight = { bits: 1n << 255n };
    expect(pixelAt(bottomRight, 15, 15)).toBe(true);
    expect(frameToAscii(bottomRight).split("\n")[15]).toBe("...............#");
  });

  it("rejects wrong counts and non-uint256 words", () => {
    expect(() => decodeFrames([])).toThrow(RangeError);
    expect(() => decodeFrames(Array.from({ length: 63 }, () => 0n))).toThrow(RangeError);
    const bad = Array.from({ length: 64 }, () => 0n);
    bad[3] = -1n;
    expect(() => decodeFrames(bad)).toThrow(/word 3/);
    bad[3] = 1n << 256n;
    expect(() => decodeFrames(bad)).toThrow(/word 3/);
  });

  it("frameBounds gives the box of the 1969 sprite and null for an empty frame", () => {
    const b = frameBounds(asciiToFrame(FRIEND_1969_FRAME0));
    expect(b).toEqual({ minX: 4, minY: 5, maxX: 12, maxY: 14, width: 9, height: 10 });
    expect(frameBounds({ bits: 0n })).toBeNull();
  });

  it("frameDiff lists changed pixels with the new value", () => {
    const a = asciiToFrame(FRIEND_1969_FRAME0);
    const b = { bits: a.bits ^ (1n << BigInt(5 * 16 + 4)) ^ (1n << BigInt(0)) };
    const diff = frameDiff(a, b);
    expect(diff).toEqual([
      { x: 0, y: 0, on: true },
      { x: 4, y: 5, on: false },
    ]);
    expect(frameDiff(a, a)).toEqual([]);
    expect(framePopCount(a)).toBe(FRIEND_1969_FRAME0.split("").filter((c) => c === "#").length);
  });

  it("decodePortrait8 reads the low 64 bits row-major", () => {
    // top row all on, plus pixel (7,7); ignore anything above bit 63
    const word = 0xffn | (1n << 63n) | (1n << 100n);
    const rows = decodePortrait8(word);
    expect(rows).toHaveLength(8);
    expect(rows[0]).toEqual(Array(8).fill(true));
    expect(rows[7]![7]).toBe(true);
    expect(rows[1]!.every((p) => !p)).toBe(true);
  });
});
