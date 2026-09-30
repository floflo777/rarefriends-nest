import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { contextOf } from "../test/setup.js";
import { createFrameBuffer, drawPetFrame, drawText, LCD_H, LCD_W, toRows } from "./framebuffer.js";
import { Lcd } from "./Lcd.jsx";
import { frameFromRows } from "./sprite.js";
import { FRIEND_1969_FRAME } from "../data/mock.js";

describe("Lcd", () => {
  it("mounts a 96x64 canvas at an integer scale and blits the buffer", () => {
    const fb = createFrameBuffer();
    fb[0] = 1;
    const { container } = render(<Lcd buffer={fb} scale={3} />);
    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(canvas?.width).toBe(LCD_W);
    expect(canvas?.height).toBe(LCD_H);
    expect(canvas?.style.width).toBe(`${LCD_W * 3}px`);
    expect(canvas?.style.imageRendering ?? "").toBeDefined();
    const ctx = contextOf(canvas as HTMLCanvasElement);
    expect(ctx?.putImageData).toHaveBeenCalled();
    const img = ctx?.lastImage;
    expect(img?.width).toBe(LCD_W);
    // First pixel is "on" (dark olive), second is "off" (pale green).
    expect(Array.from(img?.data.slice(0, 3) ?? [])).toEqual([0x31, 0x40, 0x1f]);
    expect(Array.from(img?.data.slice(4, 7) ?? [])).toEqual([0xc5, 0xd8, 0xa4]);
  });

  it("draws the 1969 frame and text into the framebuffer", () => {
    const fb = createFrameBuffer();
    drawPetFrame(fb, 0, 0, frameFromRows(FRIEND_1969_FRAME), 1);
    const rows = toRows(fb);
    expect(rows[6]?.slice(0, 16)).toBe("....########....");
    expect(rows[14]?.slice(0, 16)).toBe(".....##..##.....");
    drawText(fb, 20, 0, "A");
    expect(rows.length).toBe(LCD_H);
    expect(toRows(fb)[0]?.slice(20, 23)).toBe(".#.");
  });
});
