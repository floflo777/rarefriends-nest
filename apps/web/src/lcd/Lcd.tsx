/**
 * The LCD: a 96x64 <canvas> whose CSS size is an integer multiple of the panel size.
 * It blits a 1-bit framebuffer (Uint8Array of 96*64 0/1 values) with a two-colour
 * palette. `image-rendering: pixelated` keeps pixels crisp.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LCD_H, LCD_W } from "./framebuffer.js";

export interface LcdPalette {
  /** CSS colours for off and on pixels. */
  off: string;
  on: string;
}

export const LCD_MONO: LcdPalette = { off: "#c5d8a4", on: "#31401f" };

export interface LcdProps {
  buffer: Uint8Array;
  palette?: LcdPalette;
  /** Fixed integer scale; when omitted the LCD fits its container width. */
  scale?: number;
  label?: string;
}

function parseColor(css: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(css.trim());
  if (!m || !m[1]) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function paintBuffer(ctx: CanvasRenderingContext2D, buffer: Uint8Array, palette: LcdPalette): void {
  const img = ctx.createImageData(LCD_W, LCD_H);
  const on = parseColor(palette.on);
  const off = parseColor(palette.off);
  const d = img.data;
  const n = LCD_W * LCD_H;
  for (let i = 0; i < n; i++) {
    const c = buffer[i] ? on : off;
    const o = i * 4;
    d[o] = c[0];
    d[o + 1] = c[1];
    d[o + 2] = c[2];
    d[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

export function Lcd({ buffer, palette = LCD_MONO, scale, label = "Nest LCD" }: LcdProps) {
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
    paintBuffer(ctx, buffer, palette);
  }, [buffer, palette]);

  const s = scale ?? autoScale;
  return (
    <div ref={wrapRef} className="lcd-wrap">
      <canvas
        ref={canvasRef}
        className="lcd"
        width={LCD_W}
        height={LCD_H}
        style={{ width: LCD_W * s, height: LCD_H * s, backgroundColor: palette.off }}
        role="img"
        aria-label={label}
        data-scale={s}
      />
    </div>
  );
}
