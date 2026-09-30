import { describe, expect, it } from "vitest";
import { asciiToFrame } from "../decode.js";
import { FONT_5X7, GLYPH_HEIGHT, GLYPH_WIDTH } from "../font5x7.js";
import { ICONS, ICON_NAMES } from "../icons.js";
import {
  blitFrame,
  createLcd,
  drawBar,
  drawIcon,
  drawText5x7,
  getPixel,
  lcdToAscii,
  lcdToImageData,
  LCD_PALETTE,
  LCD_SIZE,
  renderLcd,
  renderLcdBuffer,
  textWidth5x7,
  wrapText5x7,
} from "../render.js";
import { FRIEND_1969_FRAME0 } from "./decode.test.js";

function isBinary(data: Uint8Array): boolean {
  return data.every((v) => v === 0 || v === 1);
}

describe("render primitives", () => {
  it("blitFrame places the 1969 frame at (x, y) and clips outside the screen", () => {
    const frame = asciiToFrame(FRIEND_1969_FRAME0);
    const buf = createLcd(LCD_SIZE);
    blitFrame(buf, frame, 40, 24);
    const picture = lcdToAscii(buf).split("\n");
    // row 5 of the frame is "....#......#...." -> pixels at x = 4 and 11
    expect(picture[24 + 5]!.slice(40, 56)).toBe("....#......#....");
    expect(getPixel(buf, 44, 29)).toBe(1);
    expect(isBinary(buf.data)).toBe(true);

    const edge = createLcd(LCD_SIZE);
    expect(() => blitFrame(edge, frame, 90, 60, 3)).not.toThrow();
    expect(() => blitFrame(edge, frame, -10, -10)).not.toThrow();
    expect(edge.data.length).toBe(96 * 64);
    expect(isBinary(edge.data)).toBe(true);
  });

  it("blitFrame scale 2 doubles each lit pixel", () => {
    const buf = createLcd({ width: 32, height: 32 });
    blitFrame(buf, { bits: 1n }, 0, 0, 2);
    expect(getPixel(buf, 0, 0)).toBe(1);
    expect(getPixel(buf, 1, 1)).toBe(1);
    expect(getPixel(buf, 2, 0)).toBe(0);
    expect(buf.data.reduce((a, b) => a + b, 0)).toBe(4);
  });

  it("font glyphs are all 5x7 and drawText advances 6 px per char", () => {
    for (const [ch, glyph] of Object.entries(FONT_5X7)) {
      expect(glyph, ch).toHaveLength(GLYPH_HEIGHT);
      for (const row of glyph) expect(row, `${ch} row`).toHaveLength(GLYPH_WIDTH);
    }
    const buf = createLcd(LCD_SIZE);
    const end = drawText5x7(buf, "HI 42!", 1, 1);
    expect(end).toBe(1 + 6 * 6);
    expect(textWidth5x7("HI 42!")).toBe(35);
    expect(buf.data.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    // lowercase draws the same as uppercase
    const a = createLcd(LCD_SIZE);
    const b = createLcd(LCD_SIZE);
    drawText5x7(a, "nest", 0, 0);
    drawText5x7(b, "NEST", 0, 0);
    expect(a.data).toEqual(b.data);
    // text past the right edge is clipped, never thrown
    expect(() => drawText5x7(buf, "TOO LONG FOR THE LCD ROW", 80, 60)).not.toThrow();
    expect(isBinary(buf.data)).toBe(true);
  });

  it("wrapText5x7 keeps lines within the width", () => {
    const lines = wrapText5x7("A week of RF piles up. Claim it.", 96);
    for (const l of lines) expect(textWidth5x7(l)).toBeLessThanOrEqual(96);
    expect(lines.join(" ")).toBe("A week of RF piles up. Claim it.");
  });

  it("drawBar fills proportionally inside its outline", () => {
    const buf = createLcd(LCD_SIZE);
    drawBar(buf, 2, 2, 22, 5, 0.5);
    expect(getPixel(buf, 2, 2)).toBe(1); // outline
    expect(getPixel(buf, 23, 6)).toBe(1);
    expect(getPixel(buf, 3, 4)).toBe(1); // filled interior
    expect(getPixel(buf, 12, 4)).toBe(1); // 10 of 20 inner columns
    expect(getPixel(buf, 13, 4)).toBe(0);
    const empty = createLcd(LCD_SIZE);
    drawBar(empty, 0, 0, 10, 4, 0);
    expect(getPixel(empty, 1, 1)).toBe(0);
    const full = createLcd(LCD_SIZE);
    drawBar(full, 0, 0, 10, 4, 7); // clamps to 1
    expect(getPixel(full, 8, 1)).toBe(1);
    const nan = createLcd(LCD_SIZE);
    expect(() => drawBar(nan, 0, 0, 10, 4, Number.NaN)).not.toThrow();
    expect(() => drawBar(nan, 90, 60, 20, 20, 1)).not.toThrow();
    expect(isBinary(nan.data)).toBe(true);
  });

  it("icons are 8x8 and every one draws something", () => {
    expect(ICON_NAMES).toEqual(["bowl", "heart", "bolt", "house", "coin", "egg", "zzz", "star", "cloud", "sun"]);
    for (const name of ICON_NAMES) {
      const bitmap = ICONS[name];
      expect(bitmap).toHaveLength(8);
      for (const row of bitmap) expect(row, name).toHaveLength(8);
      const buf = createLcd({ width: 8, height: 8 });
      drawIcon(buf, name, 0, 0);
      expect(buf.data.reduce((a, b) => a + b, 0), name).toBeGreaterThan(4);
      expect(() => drawIcon(buf, name, 6, -3)).not.toThrow();
    }
  });

  it("renderLcd composes layers into a 96x64 binary buffer", () => {
    const frame = asciiToFrame(FRIEND_1969_FRAME0);
    const data = renderLcd(LCD_SIZE, [
      { kind: "frame", frame, x: 40, y: 20, scale: 2 },
      { kind: "text", text: "WOBBLE", x: 2, y: 2 },
      { kind: "bar", x: 2, y: 56, w: 40, h: 6, fill: 0.3 },
      { kind: "icon", name: "bowl", x: 86, y: 2 },
      { kind: "rect", x: 0, y: 0, w: 96, h: 64 },
    ]);
    expect(data).toBeInstanceOf(Uint8Array);
    expect(data.length).toBe(96 * 64);
    expect(isBinary(data)).toBe(true);
    expect(data[0]).toBe(1); // border
    expect(data[95]).toBe(1);
    expect(data[63 * 96 + 95]).toBe(1);
    const again = renderLcd(LCD_SIZE, [
      { kind: "frame", frame, x: 40, y: 20, scale: 2 },
      { kind: "text", text: "WOBBLE", x: 2, y: 2 },
      { kind: "bar", x: 2, y: 56, w: 40, h: 6, fill: 0.3 },
      { kind: "icon", name: "bowl", x: 86, y: 2 },
      { kind: "rect", x: 0, y: 0, w: 96, h: 64 },
    ]);
    expect(again).toEqual(data); // deterministic
  });

  it("lcdToImageData maps 0/1 to the palette as RGBA", () => {
    const buf = renderLcdBuffer({ width: 3, height: 1 }, [{ kind: "pixels", points: [{ x: 1, y: 0 }] }]);
    const img = lcdToImageData(buf, LCD_PALETTE);
    expect(img.width).toBe(3);
    expect(img.height).toBe(1);
    expect(img.data).toBeInstanceOf(Uint8ClampedArray);
    expect(img.data.length).toBe(12);
    expect(Array.from(img.data.slice(0, 4))).toEqual([...LCD_PALETTE.off]);
    expect(Array.from(img.data.slice(4, 8))).toEqual([...LCD_PALETTE.on]);
    const fromRaw = lcdToImageData(renderLcd(LCD_SIZE, []), LCD_PALETTE);
    expect(fromRaw.data.length).toBe(96 * 64 * 4);
    expect(() => lcdToImageData(new Uint8Array(5), LCD_PALETTE)).toThrow(RangeError);
  });
});
