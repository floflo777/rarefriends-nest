import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { asciiToFrame, blitFrame, lcdToAscii } from "@nest/core";
import { FRIEND_1969_FRAME } from "../data/mock.js";
import { contextOf } from "../test/setup.js";
import { Lcd } from "./Lcd.jsx";
import { COLS, LCD_H, LCD_W, createPainter, fitSentence, imageOf, row, text, wrap } from "./paint.js";

describe("Lcd", () => {
  it("mounts a 96x64 canvas at an integer scale, blits the buffer and exposes the transcript", () => {
    const p = createPainter();
    p.lcd.data[0] = 1;
    text(p, 10, 10, "hello");
    const { container } = render(<Lcd image={imageOf(p)} scale={3} />);
    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(canvas?.width).toBe(LCD_W);
    expect(canvas?.height).toBe(LCD_H);
    expect(canvas?.style.width).toBe(`${LCD_W * 3}px`);
    const ctx = contextOf(canvas as HTMLCanvasElement);
    expect(ctx?.putImageData).toHaveBeenCalled();
    const img = ctx?.lastImage;
    expect(img?.width).toBe(LCD_W);
    // First pixel is "on" (dark olive), second is "off" (pale green): core's LCD palette.
    expect(Array.from(img?.data.slice(0, 3) ?? [])).toEqual([15, 56, 15]);
    expect(Array.from(img?.data.slice(4, 7) ?? [])).toEqual([155, 188, 15]);
    expect(screen.getByTestId("lcd-text").textContent).toBe("HELLO");
  });

  it("draws the 1969 frame through core and 3x5 text through the painter", () => {
    const p = createPainter();
    blitFrame(p.lcd, asciiToFrame(FRIEND_1969_FRAME), 0, 0);
    const rows = lcdToAscii(p.lcd).split("\n");
    expect(rows[6]?.slice(0, 16)).toBe("....########....");
    expect(rows[14]?.slice(0, 16)).toBe(".....##..##.....");
    text(p, 20, 0, "A");
    expect(lcdToAscii(p.lcd).split("\n")[0]?.slice(20, 23)).toBe(".#.");
    row(p, 20, "COST", "1 RF");
    expect(p.transcript).toEqual(["A", "COST 1 RF"]);
  });

  it("wraps to the LCD's 24 columns and marks a truncated tail", () => {
    expect(COLS).toBe(24);
    expect(wrap("Pays for itself in 66 weeks at the current stream", COLS, 3)).toEqual(["Pays for itself in 66", "weeks at the current", "stream"]);
    const cut = wrap("one two three four five six seven eight nine ten eleven twelve thirteen", 8, 2);
    expect(cut).toHaveLength(2);
    expect(cut[1]?.endsWith("..")).toBe(true);
    expect(wrap("", COLS, 2)).toEqual([]);
  });

  it("fitSentence never cuts with ..: whole sentence, else the conclusion clause, else a clean word boundary", () => {
    const honesty = "Pays for itself in 63 weeks at the current stream: this is a collector's spend, not a yield play.";
    expect(fitSentence(honesty, 23, 3)).toEqual(["This is a collector's", "spend, not a yield", "play."]);
    // Parenthetical dropped first; then the conclusion clause (the weeks are on the BREAK-EVEN row).
    expect(fitSentence("Pays for itself in 6.3 weeks at the current stream: cheap for what it adds (2000.0 RF a week).", 23, 3)).toEqual(["Cheap for what it adds."]);
    expect(fitSentence("Pays for itself in 63 weeks at the current stream.", 23, 3)).toEqual(["Pays for itself in 63", "weeks at the current", "stream."]);
    const claim = "Free: moves 36189.00 RF and 0.022800 WETH of unclaimed rewards into the Friend's own wallet (gas only).";
    const lines = fitSentence(claim, 23, 3);
    expect(lines).toHaveLength(3);
    expect(lines.every((l) => l.length <= 23 && !l.endsWith(".."))).toBe(true);
    expect(["the", "into", "of", "and"]).not.toContain(lines[2]!.split(" ").pop()!.toLowerCase());
    expect(fitSentence("Short.", 23, 3)).toEqual(["Short."]);
    expect(fitSentence("", 23, 3)).toEqual([]);
  });

  it("renders the arrow, middle dot and tilde glyphs instead of the unknown-glyph dot", () => {
    const p = createPainter();
    text(p, 0, 0, "\u2192");
    expect(lcdToAscii(p.lcd).split("\n").slice(0, 5).map((r) => r.slice(0, 3))).toEqual(["...", "..#", "###", "..#", "..."]);
  });
});
