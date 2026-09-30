/** jsdom has no canvas: stub a minimal 2D context that records fills, and matchMedia. */
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => cleanup());

export interface FakeContext {
  createImageData: (w: number, h: number) => ImageData;
  putImageData: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  strokeRect: ReturnType<typeof vi.fn>;
  fillText: ReturnType<typeof vi.fn>;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  textBaseline: string;
  lastImage: ImageData | null;
}

export function makeFakeContext(): FakeContext {
  const fake: FakeContext = {
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4), colorSpace: "srgb" }) as unknown as ImageData,
    putImageData: vi.fn((img: ImageData) => {
      fake.lastImage = img;
    }),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textBaseline: "top",
    lastImage: null,
  };
  return fake;
}

const contexts = new WeakMap<HTMLCanvasElement, FakeContext>();

HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
  let c = contexts.get(this);
  if (!c) {
    c = makeFakeContext();
    contexts.set(this, c);
  }
  return c as unknown as CanvasRenderingContext2D;
} as unknown as typeof HTMLCanvasElement.prototype.getContext;

export function contextOf(canvas: HTMLCanvasElement): FakeContext | undefined {
  return contexts.get(canvas);
}

if (typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
