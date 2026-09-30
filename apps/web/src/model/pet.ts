/** Everything the screens derive from a Friend at an instant, all through core. */
import {
  animationFor,
  careEventsFromBurns,
  computeVitals,
  describe,
  frameIndexAt,
  moodState,
  speechLine,
  type Animation,
  type CareEvent,
  type Friend,
  type IconName,
  type MoodState,
  type Personality,
  type ProtocolState,
  type Snapshot,
  type Vitals,
} from "@nest/core";

export interface PetState {
  personality: Personality;
  vitals: Vitals;
  mood: MoodState;
  line: string;
  animation: Animation;
}

export interface PetMemory {
  /** Care actions seen for this household (proud for 24 h after a promote/upgrade). */
  recentEvents?: readonly CareEvent[];
  /** Savings scale (vitals.savings) last time this token was on screen (thrifty when it grew). */
  previousSavings?: number;
}

/** Used while the protocol state is still loading: no stream, so hunger is 0 or 1. */
const EMPTY_PROTOCOL: ProtocolState = {
  blockNumber: 0n,
  timestamp: 0,
  totalWeight: 0n,
  rfStream: { amount: 0n, periodFinish: 0, lastUpdate: 0 },
  wethStream: { amount: 0n, periodFinish: 0, lastUpdate: 0 },
  rfTotalSupply: 0n,
};

/** @param now unix seconds */
export function petState(friend: Friend, protocol: ProtocolState | null, now: number, memory: PetMemory = {}): PetState {
  const personality = describe(friend);
  const vitals = computeVitals(friend, protocol ?? EMPTY_PROTOCOL, now);
  const mood = moodState(vitals, personality, now, memory.recentEvents, memory.previousSavings);
  return { personality, vitals, mood, line: speechLine(personality, mood, vitals, now), animation: animationFor(mood) };
}

export const MOOD_ICON: Readonly<Record<MoodState, IconName>> = {
  content: "heart",
  hungry: "bowl",
  restless: "bolt",
  proud: "star",
  sleepy: "cloud",
  thrifty: "coin",
  asleep: "zzz",
};

/** How long the star keeps blinking after a promote/upgrade (proud). */
export const PROUD_BLINK_S = 60;
/** Hungry: one glance at the bowl every this many seconds. */
const GLANCE_EVERY_S = 5;

export interface IdleMotion {
  /** Horizontal offset of the sprite in pixels (restless paces, hungry leans toward the bowl). */
  dx: number;
  /** Frame 0 only (asleep). */
  still: boolean;
  /** Hungry, looking at the bowl this second. */
  glance: boolean;
  /** Whether the mood icon is drawn this frame (bowl flicker, zzz pulse, star blink). */
  iconOn: boolean;
}

const STILL: IdleMotion = { dx: 0, still: false, glance: false, iconOn: true };

/**
 * Idle behaviour on the PET screen, derived from core's mood and clip: restless paces
 * left/right by up to 3 px over the walk clip; hungry glances at the bowl one second in five
 * (the bowl flickers); asleep holds frame 0 while the zzz pulses; proud blinks the star for
 * PROUD_BLINK_S after the last care event. Reduced motion: nothing moves or blinks.
 */
export function idleMotion(pet: PetState, now: number, reducedMotion: boolean, lastCareAt?: number): IdleMotion {
  if (reducedMotion) return pet.mood === "asleep" ? { ...STILL, still: true } : STILL;
  switch (pet.mood) {
    case "restless": {
      const i = frameIndexAt(pet.animation, now);
      const t = i < 16 ? i / 16 : (32 - i) / 16; // triangle 0..1..0 over the clip
      return { ...STILL, dx: Math.round(t * 6) - 3 };
    }
    case "hungry": {
      const glance = Math.floor(now) % GLANCE_EVERY_S === 0;
      return { dx: glance ? 2 : 0, still: false, glance, iconOn: !glance || Math.floor(now * 6) % 2 === 0 };
    }
    case "asleep":
      return { ...STILL, still: true, iconOn: Math.floor(now) % 2 === 0 };
    case "proud":
      return { ...STILL, iconOn: lastCareAt === undefined || now - lastCareAt >= PROUD_BLINK_S || Math.floor(now * 2) % 2 === 0 };
    default:
      return STILL;
  }
}

/** The most recent care event's time, if any. */
export function lastCareAt(memory: PetMemory): number | undefined {
  const times = (memory.recentEvents ?? []).map((e) => e.at);
  return times.length > 0 ? Math.max(...times) : undefined;
}

export interface PetIdentity {
  /** Header name: core's registry-derived name (Generations) or Genesis name. */
  name: string;
  /** Upper-case family label: the registry family, or GENESIS (Genesis has no family). */
  familyLabel: string;
}

/** Core's `describe` recognises Genesis itself: its family is "Genesis", never a registry family. */
export function identityOf(friend: Friend): PetIdentity {
  const p = describe(friend);
  return { name: p.name, familyLabel: (friend.familyName ?? p.family).toUpperCase() };
}

export function genTier(f: Friend): string {
  return f.collection === "Genesis" ? `GENESIS T${f.position.tier}` : `G${f.generation} T${f.position.tier}`;
}

/** Filled segments of the 6-step generation band: Gen-6 pup = 1, Gen-1 = 6, Genesis = 6. */
export function territorySteps(f: Friend): number {
  if (f.collection === "Genesis") return 6;
  return Math.max(1, Math.min(6, 7 - f.generation));
}

const SAVINGS_KEY = "nest.savings.";

/** Savings scale remembered for this token from an earlier visit, if any. */
export function previousSavings(key: string): number | undefined {
  try {
    const raw = localStorage.getItem(SAVINGS_KEY + key);
    if (raw === null) return undefined;
    const v = Number(raw);
    return Number.isFinite(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

export function rememberSavings(key: string, value: number): void {
  try {
    localStorage.setItem(SAVINGS_KEY + key, String(value));
  } catch {
    // Storage is optional.
  }
}

/**
 * Care events for the pet's owner: this session's own promotes/upgrades plus, from the
 * snapshot leaderboard, the household's last indexed action. The leaderboard does not say
 * which function it was, so a recent paid action reads as an upgrade; core's
 * `careEventsFromBurns` applies its time window (nothing in the future, nothing older than a week).
 */
export function recentCareEvents(owner: string | undefined, snapshot: Snapshot | null, now: number, local: readonly CareEvent[]): CareEvent[] {
  const rank = owner && snapshot ? snapshot.leaderboard.find((r) => r.owner.toLowerCase() === owner.toLowerCase()) : undefined;
  const indexed = rank && rank.lastActionAt > 0 ? careEventsFromBurns([{ timestamp: rank.lastActionAt, action: "upgrade" }], now) : [];
  return [...local, ...indexed];
}
