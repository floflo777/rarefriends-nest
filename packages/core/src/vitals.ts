/**
 * Vitals: numbers in [0, 1] derived from chain state only (docs/design.md, "The player loop").
 * Pure; `now` is unix seconds like every timestamp in ProtocolState.
 */
import type { Friend, ProtocolState, Vitals } from "./types.js";

const WEI = 1e18;
/** Weight of a freshly hardwired Gen-6 at tier 0: 1 RF x 11,000 bps. Mood reference. */
export const REFERENCE_WEIGHT_RF = 1.1;
/** Savings that count as "full" on the log scale: one Genesis denomination. */
export const SAVINGS_FULL_RF = 1_000_000;
/** log10 span (in decades above the reference weight) that saturates the mood squash. */
const MOOD_DECADES = 3.5;

function weiToNumber(x: bigint): number {
  return Number(x) / WEI;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** (-inf, +inf) -> (0, 1), 0 -> 0.5, monotonic. */
function squash(x: number): number {
  return 0.5 + 0.5 * Math.tanh(x / MOOD_DECADES);
}

/** Weekly RF this Friend receives from the current stream, 0 once the stream period has ended. */
export function weeklyRfFromStream(friend: Friend, state: ProtocolState, now: number): number {
  const share = streamShare(friend, state);
  if (share === 0) return 0;
  const finish = state.rfStream.periodFinish;
  if (finish > 0 && now > finish) return 0;
  return share * weiToNumber(state.rfStream.amount);
}

/** weight / totalWeight, 0 when either is 0. */
export function streamShare(friend: Friend, state: ProtocolState): number {
  if (friend.position.weight <= 0n || state.totalWeight <= 0n) return 0;
  return Number(friend.position.weight) / Number(state.totalWeight);
}

/**
 * Mood from absolute weight: 0.5 for a Gen-6 tier-0 pup, rising with each generation
 * and tier on a log scale, 0 for an inactive Friend.
 */
export function moodFromWeight(weightWei: bigint): number {
  if (weightWei <= 0n) return 0;
  return clamp01(squash(Math.log10(weiToNumber(weightWei) / REFERENCE_WEIGHT_RF)));
}

/** log10(1 + RF) over log10(1 + 1,000,000): 100 RF -> 0.33, 10k -> 0.67, 1M -> 1. */
export function savingsScale(totalRf: number): number {
  if (!(totalRf > 0)) return 0;
  return clamp01(Math.log10(1 + totalRf) / Math.log10(1 + SAVINGS_FULL_RF));
}

/**
 * @param now unix seconds
 * @param wethRfRate RF per 1 WETH, used to count the wallet's WETH in the savings scale;
 *   when omitted WETH is ignored (treated as 0).
 */
export function computeVitals(friend: Friend, state: ProtocolState, now: number, wethRfRate?: number): Vitals {
  const share = streamShare(friend, state);
  const weekly = weeklyRfFromStream(friend, state, now);
  const unclaimedRf = weiToNumber(friend.rewards.earnedRf);

  const hunger = weekly > 0 ? clamp01(unclaimedRf / weekly) : unclaimedRf > 0 ? 1 : 0;
  const strength = clamp01(friend.position.tier / 4);
  const territory = friend.collection === "Genesis" ? 1 : clamp01((7 - friend.generation) / 6);

  const rate = wethRfRate !== undefined && Number.isFinite(wethRfRate) && wethRfRate > 0 ? wethRfRate : 0;
  const savingsRf = weiToNumber(friend.savings.rf) + weiToNumber(friend.savings.weth) * rate;

  return {
    hunger,
    strength,
    territory,
    mood: moodFromWeight(friend.position.weight),
    savings: savingsScale(savingsRf),
    awake: friend.position.active,
    weeklyRfFromStream: weekly,
    streamShare: share,
  };
}
