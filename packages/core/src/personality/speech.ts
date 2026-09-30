/** What the pet says: one line <= 22 chars per (family, mood), stable for a UTC day. */
import type { MoodState, Personality, Vitals } from "../types.js";
import { seedHash } from "./hash.js";
import { familyIdOf } from "./describe.js";
import { DAY_SECONDS } from "./mood.js";
import { MAX_SPEECH_CHARS, SPEECH, URGENT_LINES } from "./tables.js";

function seedOfPersonality(p: Personality): number {
  return p.seed ?? seedHash(0, p.name, p.family);
}

/** The pool a line is drawn from for this family and mood. */
export function speechPool(personality: Personality, mood: MoodState, vitals?: Vitals): readonly string[] {
  const table = SPEECH[familyIdOf(personality.family)] ?? SPEECH[0]!;
  const base = table[mood];
  const urgent = vitals !== undefined && vitals.hunger >= 0.99 && (mood === "hungry" || mood === "restless");
  return urgent ? [...base, ...URGENT_LINES] : base;
}

/**
 * Deterministic in (seed, UTC day of `now`, mood); `now` is unix seconds and defaults
 * to 0 so callers without a clock still get a stable line.
 */
export function speechLine(personality: Personality, mood: MoodState, vitals: Vitals, now = 0): string {
  const pool = speechPool(personality, mood, vitals);
  const day = Math.floor(now / DAY_SECONDS);
  const line = pool[seedHash(seedOfPersonality(personality), "speech", day, mood) % pool.length] ?? "";
  return line.length > MAX_SPEECH_CHARS ? line.slice(0, MAX_SPEECH_CHARS) : line;
}
