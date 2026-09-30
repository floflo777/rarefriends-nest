/** What the pet says: one line <= 22 chars per (family, mood), stable for a UTC hour. */
import type { MoodState, Personality, Vitals } from "../types.js";
import { seedHash } from "./hash.js";
import { familyIdOf } from "./describe.js";
import { DAY_SECONDS } from "./mood.js";
import { GENESIS_SPEECH, MAX_SPEECH_CHARS, SPEECH, URGENT_LINES } from "./tables.js";

const HOUR_SECONDS = 3600;

function seedOfPersonality(p: Personality): number {
  return p.seed ?? seedHash(0, p.name, p.family);
}

/** The pool a line is drawn from for this family and mood. */
export function speechPool(personality: Personality, mood: MoodState, vitals?: Vitals): readonly string[] {
  const table = personality.family === "Genesis" ? GENESIS_SPEECH : (SPEECH[familyIdOf(personality.family)] ?? SPEECH[0]!);
  const base = table[mood];
  const urgent = vitals !== undefined && vitals.hunger >= 0.99 && (mood === "hungry" || mood === "restless");
  return urgent ? [...base, ...URGENT_LINES] : base;
}

/**
 * Deterministic in (seed, UTC day and UTC hour of `now`, mood), so a pet says something new
 * every hour; `now` is unix seconds and defaults to 0 so callers without a clock still get
 * a stable line.
 */
export function speechLine(personality: Personality, mood: MoodState, vitals: Vitals, now = 0): string {
  const pool = speechPool(personality, mood, vitals);
  const day = Math.floor(now / DAY_SECONDS);
  const hour = Math.floor((now - day * DAY_SECONDS) / HOUR_SECONDS);
  const line = pool[seedHash(seedOfPersonality(personality), "speech", day, hour, mood) % pool.length] ?? "";
  return line.length > MAX_SPEECH_CHARS ? line.slice(0, MAX_SPEECH_CHARS) : line;
}
