/**
 * Vitals and mood derived from chain state. packages/core is writing the canonical
 * version (personality + vitals); this module is the web's placeholder with the same
 * `Vitals`/`MoodState` shape so the swap is a one-line import change.
 */
import { STREAM_SECONDS, type Friend, type MoodState, type ProtocolState, type Vitals } from "@nest/core";
import { toUnits } from "./format.js";

export function weeklyRfFor(weight: bigint, protocol: ProtocolState): number {
  const total = toUnits(protocol.totalWeight);
  if (total <= 0) return 0;
  const perPeriod = toUnits(protocol.rfStream.amount);
  return (toUnits(weight) / total) * perPeriod * ((7 * 24 * 3600) / STREAM_SECONDS);
}

export function deriveVitals(friend: Friend, protocol: ProtocolState): Vitals {
  const weeklyRf = weeklyRfFor(friend.position.weight, protocol);
  const earned = toUnits(friend.rewards.earnedRf);
  const hunger = weeklyRf > 0 ? Math.min(1, earned / weeklyRf) : earned > 0 ? 1 : 0;
  const streamShare = toUnits(protocol.totalWeight) > 0 ? toUnits(friend.position.weight) / toUnits(protocol.totalWeight) : 0;
  const savingsRf = toUnits(friend.savings.rf) + toUnits(friend.savings.weth) * 3000 + toUnits(friend.savings.eth) * 3000;
  return {
    hunger,
    strength: friend.position.tier / 4,
    territory: friend.collection === "Genesis" ? 1 : (7 - friend.generation) / 6,
    mood: 1 - Math.exp(-streamShare * 5000),
    savings: savingsRf > 0 ? Math.min(1, Math.log10(1 + savingsRf) / 6) : 0,
    awake: friend.position.active,
    weeklyRfFromStream: weeklyRf,
    streamShare,
  };
}

export function moodOf(vitals: Vitals): MoodState {
  if (!vitals.awake) return "asleep";
  if (vitals.hunger >= 0.75) return "hungry";
  if (vitals.hunger >= 0.4) return "restless";
  if (vitals.strength >= 0.75) return "proud";
  if (vitals.savings >= 0.5) return "thrifty";
  if (vitals.mood < 0.05) return "sleepy";
  return "content";
}

/** Display name. core's personality (seed -> name) replaces this. */
export function petName(friend: Friend): string {
  return `#${friend.tokenId.toString()}`;
}
