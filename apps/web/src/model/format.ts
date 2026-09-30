/**
 * Formatting helpers. Amounts arrive as bigint wei (18 decimals) and leave as short LCD
 * strings. Never scientific notation: an LCD reader gets "<0.001%" rather than "1.9e-5%".
 */
import { weiToRf } from "@nest/core";

/** Three significant digits, no exponent: 36.384 -> "36.4", 112.5 -> "113", 1.15 -> "1.15". */
function sig3(v: number): string {
  if (v >= 99.95) return Math.round(v).toString();
  if (v >= 9.995) return trimZeros(v.toFixed(1));
  return trimZeros(v.toFixed(2));
}

/**
 * 8,547,984 -> "8.55M", 416,250 -> "416K", 36,384.65 -> "36.4K", 3,331.5 -> "3,332",
 * 62.6 -> "62.6", 0.05 -> "0.05", 0.0088 -> "0.0088". `digits` caps decimals below 1,000.
 */
export function compact(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "-";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs === 0) return "0";
  if (abs >= 999.5e6) return `${sign}${sig3(abs / 1e9)}B`;
  if (abs >= 999.5e3) return `${sign}${sig3(abs / 1e6)}M`;
  if (abs >= 9_999.5) return `${sign}${sig3(abs / 1e3)}K`;
  if (abs >= 999.5) return `${sign}${Math.round(abs).toLocaleString("en-US")}`;
  if (abs >= 1) return `${sign}${trimZeros(abs.toFixed(digits))}`;
  // Below 1: three significant digits, at most six decimals, never an exponent.
  const decimals = Math.min(6, 2 - Math.floor(Math.log10(abs)));
  const s = trimZeros(abs.toFixed(decimals));
  return s === "0" ? `${sign}<0.000001` : `${sign}${s}`;
}

/** Compact form of a wei amount. */
export function compactWei(wei: bigint, digits = 2): string {
  return compact(weiToRf(wei), digits);
}

/** Whole number with thousands separators when it fits in `maxLen`, otherwise compact. */
export function grouped(n: number, maxLen = 9): string {
  const s = Math.round(n).toLocaleString("en-US");
  return s.length <= maxLen ? s : compact(n);
}

/** Threshold under which a share is not worth a digit on the LCD. */
export const MIN_PERCENT = 0.001;

/** 0.00038948 -> "0.0389%", 0.00187137 -> "0.187%", 1.9e-7 -> "<0.001%", 0 -> "0%". */
export function percent(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return "0%";
  const pct = ratio * 100;
  if (pct < MIN_PERCENT) return `<${MIN_PERCENT}%`;
  if (pct >= 99.95) return `${Math.round(pct)}%`;
  return `${trimZeros(Number(pct.toPrecision(3)).toFixed(6))}%`;
}

export function shortAddress(address: string, chars = 4): string {
  return `${address.slice(0, 2 + chars)}..${address.slice(-chars)}`;
}

export function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}..${hash.slice(-6)}`;
}

function trimZeros(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}
