/** Everything the screens derive from a Friend at an instant, all through core. */
import {
  animationFor,
  computeVitals,
  describe,
  moodState,
  speechLine,
  DAY_SECONDS,
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

export interface PetIdentity {
  /** Header name: the registry-derived name for Generations, "#id" for Genesis. */
  name: string;
  /** Upper-case family label: the registry family, or GENESIS (Genesis has no family). */
  familyLabel: string;
}

/**
 * Genesis Friends have no Generations family: the CLI prints "family —" and no name, so
 * does the LCD. Core's `describe` is used as soon as it recognises Genesis itself.
 */
// TODO(core): rely on core's Genesis personality (describe -> family "Genesis") once it lands.
export function identityOf(friend: Friend): PetIdentity {
  const p = describe(friend);
  if (friend.collection === "Genesis") {
    return { name: p.family === "Genesis" ? p.name : `#${friend.tokenId}`, familyLabel: "GENESIS" };
  }
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
 * snapshot leaderboard, the household's last indexed action when it is under a day old.
 */
// TODO(core): use `careEventsFromBurns(records, owner)` for typed per-action events once exported.
export function recentCareEvents(owner: string | undefined, snapshot: Snapshot | null, now: number, local: readonly CareEvent[]): CareEvent[] {
  const events = [...local];
  if (owner && snapshot) {
    const rank = snapshot.leaderboard.find((r) => r.owner.toLowerCase() === owner.toLowerCase());
    if (rank && rank.lastActionAt > 0 && now - rank.lastActionAt <= DAY_SECONDS && rank.lastActionAt <= now) {
      // The leaderboard does not say which function it was: a recent paid action reads as an upgrade.
      events.push({ action: "upgrade", at: rank.lastActionAt });
    }
  }
  return events;
}
