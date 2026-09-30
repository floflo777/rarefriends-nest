/**
 * Mood state machine over vitals, personality and the clock, plus the clip to play.
 * `now` and event times are unix seconds.
 */
import { ACTION_SELECTORS, type ActionName } from "../protocol/constants.js";
import type { MoodState, Personality, Vitals } from "../types.js";

/** A care action observed on chain for this Friend or its household. */
export interface CareEvent {
  action: ActionName;
  /** unix seconds */
  at: number;
}

export const DAY_SECONDS = 86_400;
/** How far back `careEventsFromBurns` keeps events (a week: the stream period). */
export const CARE_EVENT_WINDOW = 7 * DAY_SECONDS;

const ACTION_NAMES: ReadonlySet<string> = new Set(Object.values(ACTION_SELECTORS));

function isActionName(s: string): s is ActionName {
  return ACTION_NAMES.has(s);
}

/**
 * Turns indexed burn records (snapshot `BurnRecord`s or any `{timestamp, action}` rows for
 * one household) into CareEvents for `moodState`. Keeps known protocol actions at or before
 * `now` and within CARE_EVENT_WINDOW; "unknown" selectors are dropped. Newest first.
 * Pure: the caller filters records to the household it wants (e.g. by `from`).
 */
export function careEventsFromBurns(records: readonly { timestamp: number; action: string }[], now: number): CareEvent[] {
  const out: CareEvent[] = [];
  for (const r of records) {
    if (!isActionName(r.action)) continue;
    if (!Number.isFinite(r.timestamp) || r.timestamp > now || now - r.timestamp > CARE_EVENT_WINDOW) continue;
    out.push({ action: r.action, at: r.timestamp });
  }
  return out.sort((a, b) => b.at - a.at);
}
/** Hunger at which even a sleeping pet wakes up. */
export const WAKE_HUNGER = 0.9;
/** Distance to the favourite hour, in hours, that counts as "near". */
export const HOUR_WINDOW = 1;

/** Fractional UTC hour of a unix timestamp, in [0, 24). */
export function utcHour(now: number): number {
  const h = (now / 3600) % 24;
  return h < 0 ? h + 24 : h;
}

/** Circular distance between two hours on a 24 h clock. */
export function hourDistance(a: number, b: number): number {
  const d = Math.abs(((a - b) % 24 + 24) % 24);
  return Math.min(d, 24 - d);
}

export function isNearHour(now: number, hour: number, window = HOUR_WINDOW): boolean {
  return hourDistance(utcHour(now), hour) <= window;
}

/** Sleeping hour: opposite the favourite hour. */
export function bedtimeHour(personality: Personality): number {
  return (personality.favouriteHour + 12) % 24;
}

export function hasRecentPromotion(events: readonly CareEvent[] | undefined, now: number): boolean {
  if (events === undefined) return false;
  return events.some((e) => (e.action === "promote" || e.action === "upgrade") && e.at <= now && now - e.at <= DAY_SECONDS);
}

/**
 * Priority: asleep (inactive, or bedtime unless very hungry) > restless > hungry >
 * proud (promotion/upgrade in the last 24 h) > thrifty (savings grew since
 * `previousSavings`) > sleepy (near the favourite hour) > content.
 *
 * `recentEvents`: build with `careEventsFromBurns` from the household's indexed burn
 * records (snapshot) or from the app's own just-confirmed transactions.
 *
 * `previousSavings`: the `vitals.savings` value (0..1 log scale) the app last saw for this
 * Friend. Core has no storage; the app keeps it per `${collection}:${tokenId}` in
 * localStorage, passes it here, then overwrites it with the current `vitals.savings` after
 * rendering. Omit it on the first visit (no "thrifty" without a baseline).
 */
export function moodState(
  vitals: Vitals,
  personality: Personality,
  now: number,
  recentEvents?: readonly CareEvent[],
  previousSavings?: number,
): MoodState {
  if (!vitals.awake) return "asleep";
  if (vitals.hunger < WAKE_HUNGER && isNearHour(now, bedtimeHour(personality))) return "asleep";
  const threshold = personality.hungerThreshold;
  if (vitals.hunger >= Math.min(1, threshold + 0.3)) return "restless";
  if (vitals.hunger >= threshold) return "hungry";
  if (hasRecentPromotion(recentEvents, now)) return "proud";
  if (previousSavings !== undefined && vitals.savings > previousSavings + 1e-9) return "thrifty";
  if (isNearHour(now, personality.favouriteHour)) return "sleepy";
  return "content";
}

export type ClipName = "idle" | "walk";

export interface Animation {
  clip: ClipName;
  /** frames per second over the 32-frame clip */
  fps: number;
  loop: boolean;
}

const ANIMATIONS: Readonly<Record<MoodState, Animation>> = {
  content: { clip: "idle", fps: 4, loop: true },
  hungry: { clip: "idle", fps: 3, loop: true },
  restless: { clip: "walk", fps: 8, loop: true },
  proud: { clip: "walk", fps: 6, loop: true },
  sleepy: { clip: "idle", fps: 2, loop: true },
  thrifty: { clip: "idle", fps: 5, loop: true },
  asleep: { clip: "idle", fps: 1, loop: true },
};

export function animationFor(mood: MoodState): Animation {
  return ANIMATIONS[mood];
}

/** Index into the 32-frame clip at time `now` (seconds, fractional allowed). */
export function frameIndexAt(animation: Animation, now: number, clipLength = 32): number {
  const n = Math.floor(now * animation.fps);
  return ((n % clipLength) + clipLength) % clipLength;
}
