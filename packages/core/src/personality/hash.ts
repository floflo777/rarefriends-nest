/** Deterministic 32-bit mixing for personality tables. No randomness anywhere. */

function mix(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function foldNumber(n: number): number {
  const v = Math.floor(Math.abs(n));
  // fold the high 32 bits of large ids (token ids can exceed 2^32) into the low word
  return ((v >>> 0) ^ (Math.floor(v / 0x1_0000_0000) >>> 0)) >>> 0;
}

function foldString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** Stable uint32 of the seed and any salts (numbers or strings). */
export function seedHash(seed: number, ...salts: readonly (number | string)[]): number {
  let h = mix(foldNumber(seed) ^ 0x9e3779b9);
  for (const s of salts) h = mix(h ^ (typeof s === "string" ? foldString(s) : foldNumber(s)));
  return h;
}

/** Deterministic element of a non-empty list. */
export function seedPick<T>(items: readonly T[], seed: number, ...salts: readonly (number | string)[]): T {
  if (items.length === 0) throw new RangeError("seedPick: empty list");
  const item = items[seedHash(seed, ...salts) % items.length];
  if (item === undefined) throw new RangeError("seedPick: unreachable");
  return item;
}
