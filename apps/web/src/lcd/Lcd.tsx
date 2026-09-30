/**
 * The LCD: a 96x64 <canvas> whose CSS size is an integer multiple of the panel size.
 * It blits core's 1-bit buffer through `lcdToImageData` with a two-colour palette and
 * mirrors the screen's text transcript into a visually hidden element for screen readers
 * (and tests). `image-rendering: pixelated` keeps pixels crisp.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LCD_PALETTE, lcdToImageData, type LcdPalette } from "@nest/core";
import { LCD_H, LCD_W, type ScreenImage } from "./paint.js";

export { LCD_PALETTE };

export interface LcdProps {
  image: ScreenImage;
  palette?: LcdPalette;
  /** Fixed integer scale; when omitted the LCD fits its container width. */
  scale?: number;
  label?: string;
}

export function cssColor(c: LcdPalette["off"]): string {
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export function paintBuffer(ctx: CanvasRenderingContext2D, pixels: Uint8Array, palette: LcdPalette): void {
  const rgba = lcdToImageData(pixels, palette);
  const img = ctx.createImageData(rgba.width, rgba.height);
  img.data.set(rgba.data);
  ctx.putImageData(img, 0, 0);
}

export function Lcd({ image, palette = LCD_PALETTE, scale, label = "Nest LCD" }: LcdProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [autoScale, setAutoScale] = useState(3);

  useLayoutEffect(() => {
    if (scale !== undefined) return;
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setAutoScale(Math.max(1, Math.min(8, Math.floor(w / LCD_W))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scale]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    paintBuffer(ctx, image.pixels, palette);
  }, [image, palette]);

  const s = scale ?? autoScale;
  return (
    <div ref={wrapRef} className="lcd-wrap">
      <canvas
        ref={canvasRef}
        className="lcd"
        width={LCD_W}
        height={LCD_H}
        style={{ width: LCD_W * s, height: LCD_H * s, backgroundColor: cssColor(palette.off) }}
        role="img"
        aria-label={label}
        aria-describedby="lcd-text"
        data-scale={s}
      />
      <div id="lcd-text" className="sr-only" data-testid="lcd-text">
        {image.text.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </div>
  );
}
