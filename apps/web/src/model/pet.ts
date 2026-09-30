/** Everything the screens derive from a Friend at an instant, all through core. */
import {
  animationFor,
  computeVitals,
  describe,
  moodState,
  speechLine,
  type Animation,
  type Friend,
  type IconName,
  type MoodState,
  type Personality,
  type ProtocolState,
  type Vitals,
} from "@nest/core";

export interface PetState {
  personality: Personality;
  vitals: Vitals;
  mood: MoodState;
  line: string;
  animation: Animation;
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
export function petState(friend: Friend, protocol: ProtocolState | null, now: number): PetState {
  const personality = describe(friend);
  const vitals = computeVitals(friend, protocol ?? EMPTY_PROTOCOL, now);
  const mood = moodState(vitals, personality, now);
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

export function genTier(f: Friend): string {
  return f.collection === "Genesis" ? `GENESIS T${f.position.tier}` : `G${f.generation} T${f.position.tier}`;
}
