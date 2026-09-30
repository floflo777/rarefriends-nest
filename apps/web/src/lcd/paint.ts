/**
 * Text and layout helpers over core's LCD buffer. Pixels come from @nest/core
 * (createLcd, blitPattern, fillRect, drawBar, drawIcon, blitFrame); this module adds the
 * handheld's 3x5 font and a plain-text transcript of everything written, which feeds the
 * canvas' accessible description and the tests.
 */
import { LCD_SIZE, blitPattern, createLcd, getPixel, setPixel, type LcdBuffer } from "@nest/core";
import { CHAR_ADVANCE, glyphRows, textWidth } from "./font.js";

export const LCD_W = LCD_SIZE.width;
export const LCD_H = LCD_SIZE.height;
/** Characters per full-width row with the 3x5 font. */
export const COLS = Math.floor((LCD_W + 1) / CHAR_ADVANCE);

export interface Painter {
  lcd: LcdBuffer;
  /** Every string written, in drawing order (uppercase, as displayed). */
  transcript: string[];
}

export interface ScreenImage {
  pixels: Uint8Array;
  text: string[];
}

export function createPainter(): Painter {
  return { lcd: createLcd(LCD_SIZE), transcript: [] };
}

export function imageOf(p: Painter): ScreenImage {
  return { pixels: p.lcd.data, text: p.transcript };
}

function glyphs(p: Painter, x: number, y: number, s: string, on: boolean): number {
  let cx = x;
  for (const ch of s) {
    blitPattern(p.lcd, glyphRows(ch), cx, y, on);
    cx += CHAR_ADVANCE;
  }
  return cx;
}

/** Draws `s` at (x, y) and records it; returns the x after the last glyph. */
export function text(p: Painter, x: number, y: number, s: string, on = true): number {
  if (s.length === 0) return x;
  p.transcript.push(s.toUpperCase());
  return glyphs(p, x, y, s, on);
}

export function textRight(p: Painter, right: number, y: number, s: string): void {
  text(p, right - textWidth(s), y, s);
}

export function textCentered(p: Painter, y: number, s: string, x0 = 0, w = LCD_W): void {
  text(p, x0 + Math.floor((w - textWidth(s)) / 2), y, s);
}

/** Label left, value right on one row; recorded as a single "LABEL VALUE" line. */
export function row(p: Painter, y: number, label: string, value: string, x0 = 1, right = LCD_W - 2): void {
  p.transcript.push(`${label} ${value}`.trim().toUpperCase());
  glyphs(p, x0, y, label, true);
  glyphs(p, right - textWidth(value), y, value, true);
}

export function invertRect(p: Painter, x: number, y: number, w: number, h: number): void {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) setPixel(p.lcd, i, j, getPixel(p.lcd, i, j) === 0);
}

/** Truncates to at most `cols` characters. */
export function fit(s: string, cols: number): string {
  return s.length <= cols ? s : s.slice(0, Math.max(0, cols));
}

/** Word-wraps into at most `maxLines` rows of `cols`; a truncated tail ends with "..". */
export function wrap(s: string, cols: number, maxLines: number): string[] {
  const lines: string[] = [];
  let cur = "";
  const flush = (): void => {
    if (cur) lines.push(cur);
    cur = "";
  };
  for (const word of s.split(/\s+/).filter((w) => w.length > 0)) {
    let w = word;
    while (w.length > cols) {
      flush();
      lines.push(w.slice(0, cols));
      w = w.slice(cols);
    }
    const candidate = cur ? `${cur} ${w}` : w;
    if (candidate.length <= cols) cur = candidate;
    else {
      flush();
      cur = w;
    }
  }
  flush();
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${fit(kept[maxLines - 1] ?? "", cols - 2).trimEnd()}..`;
  return kept;
}

/** Word-wraps without truncating: returns every row, however many. */
export function wrapAll(s: string, cols: number): string[] {
  return wrap(s, cols, Number.MAX_SAFE_INTEGER);
}

/** Words that must not end a shortened sentence. */
const DANGLING = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "its", "of", "on", "or", "own", "so", "than", "the", "this", "to", "with"]);

function tidy(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/[\s,;:(]+$/g, "")
    .trim();
}

/**
 * Fits a sentence into `maxLines` full rows with no `..` marker. In order: the whole
 * sentence; the sentence without parentheticals; its last clause (after `:` or `;`, the
 * conclusion) when it has at least three words; its first clause; otherwise the sentence
 * shortened word by word from the end, never ending on a dangling word or punctuation.
 */
export function fitSentence(s: string, cols: number, maxLines: number): string[] {
  const fits = (t: string): string[] | null => {
    const lines = wrapAll(t, cols);
    return lines.length <= maxLines && lines.every((l) => l.length <= cols) ? lines : null;
  };
  const whole = tidy(s);
  if (whole.length === 0) return [];
  const direct = fits(whole);
  if (direct) return direct;

  const noParens = tidy(whole.replace(/\s*\([^)]*\)/g, ""));
  const candidates: string[] = [];
  if (noParens !== whole) candidates.push(noParens);
  const clauses = noParens.split(/\s*[:;]\s+/).map(tidy).filter((c) => c.length > 0);
  if (clauses.length > 1) {
    // A clause stands alone only when it says something: three words or more.
    const last = clauses[clauses.length - 1]!;
    if (last.split(" ").length >= 3) candidates.push(last[0]!.toUpperCase() + last.slice(1));
    const first = clauses[0]!;
    if (first.split(" ").length >= 3) candidates.push(first);
  }
  for (const c of candidates) {
    const lines = fits(c);
    if (lines) return lines;
  }

  const words = noParens.replace(/[.!?]+$/, "").split(" ");
  while (words.length > 1) {
    words.pop();
    while (words.length > 1 && DANGLING.has(words[words.length - 1]!.toLowerCase().replace(/[^a-z']/g, ""))) words.pop();
    const lines = fits(tidy(words.join(" ")));
    if (lines) return lines;
  }
  return wrapAll(words[0] ?? "", cols).slice(0, maxLines);
}
