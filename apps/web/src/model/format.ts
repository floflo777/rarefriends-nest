/** Formatting helpers. Amounts arrive as bigint wei (18 decimals) and leave as short LCD strings. */
import { weiToRf } from "@nest/core";

/** 1234567.8 -> "1.23M", 8547984 -> "8.55M", 416250 -> "416K"; below 1,000 keeps decimals. */
export function compact(n: number, digits = 2): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return trimZeros((n / 1e9).toFixed(digits)) + "B";
  if (abs >= 1e6) return trimZeros((n / 1e6).toFixed(digits)) + "M";
  if (abs >= 1e5) return trimZeros((n / 1e3).toFixed(0)) + "K";
  if (abs >= 1000) return Math.round(n).toString();
  if (abs >= 1) return trimZeros(n.toFixed(digits));
  if (abs === 0) return "0";
  return trimZeros(n.toFixed(4));
}

/** Compact form of a wei amount. */
export function compactWei(wei: bigint, digits = 2): string {
  return compact(weiToRf(wei), digits);
}

/** Whole number with thousands separators when it fits, otherwise compact. */
export function grouped(n: number, maxLen = 9): string {
  const s = Math.round(n).toLocaleString("en-US");
  return s.length <= maxLen ? s : compact(n);
}

export function percent(ratio: number): string {
  if (ratio === 0) return "0%";
  if (ratio < 0.0001) return (ratio * 100).toExponential(1) + "%";
  return trimZeros((ratio * 100).toFixed(4)) + "%";
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
