/**
 * Protocol maths, pure. Functions ending in Rf take and return RF units (number);
 * functions ending in Wei return exact bigint wei for calldata and approvals.
 * Every formula here was checked against live `positions()` weights (docs/dry-run.md).
 */
import { formatUnits } from "viem";
import type { Collection } from "../types.js";
import {
  BURN_SHARE,
  DENOMINATION_RF,
  GENERATION_WEIGHT_BPS,
  GENESIS_DENOMINATION_RF,
  GENESIS_WEIGHT,
  TIER_CUMULATIVE_BPS,
} from "./constants.js";

export const RF_DECIMALS = 18;
export const WEI_PER_RF = 10n ** 18n;
export const MAX_TIER = 4;

export function weiToRf(wei: bigint): number {
  return Number(formatUnits(wei, RF_DECIMALS));
}

/** Exact for integers and short decimals (0.5, 0.75); not for arbitrary floats. */
export function rfToWei(rf: number): bigint {
  if (!Number.isFinite(rf) || rf < 0) throw new RangeError(`invalid RF amount ${rf}`);
  const [whole = "0", frac = ""] = rf.toFixed(RF_DECIMALS).split(".");
  return BigInt(whole) * WEI_PER_RF + BigInt(frac.padEnd(RF_DECIMALS, "0").slice(0, RF_DECIMALS));
}

function assertGeneration(gen: number): void {
  if (!Number.isInteger(gen) || gen < 1 || gen > 6) throw new RangeError(`generation must be 1..6, got ${gen}`);
}

function assertTier(tier: number): void {
  if (!Number.isInteger(tier) || tier < 0 || tier > MAX_TIER) throw new RangeError(`tier must be 0..4, got ${tier}`);
}

function cumulativeBps(tier: number): number {
  assertTier(tier);
  const bps = TIER_CUMULATIVE_BPS[tier];
  if (bps === undefined) throw new RangeError(`no cumulative bps for tier ${tier}`);
  return bps;
}

/** Hardwire price of a generation in RF (also the Friend's "denomination"). */
export function denominationRf(collection: Collection, gen: number): number {
  if (collection === "Genesis") return GENESIS_DENOMINATION_RF;
  assertGeneration(gen);
  const d = DENOMINATION_RF[gen];
  if (d === undefined) throw new RangeError(`no denomination for generation ${gen}`);
  return d;
}

export function denominationWei(collection: Collection, gen: number): bigint {
  return BigInt(denominationRf(collection, gen)) * WEI_PER_RF;
}

export function hardwireCostRf(gen: number): number {
  return denominationRf("Generations", gen);
}

export function hardwireCostWei(gen: number): bigint {
  return denominationWei("Generations", gen);
}

/** promote(id) from `fromGen` to `fromGen - 1`: pay the difference in denominations. */
export function promoteCostWei(fromGen: number): bigint {
  assertGeneration(fromGen);
  if (fromGen === 1) throw new RangeError("generation 1 cannot be promoted");
  return denominationWei("Generations", fromGen - 1) - denominationWei("Generations", fromGen);
}

export function promoteCostRf(fromGen: number): number {
  return weiToRf(promoteCostWei(fromGen));
}

/** upgrade(collection, id) from `tier` to `tier + 1`. */
export function upgradeCostWei(collection: Collection, gen: number, tier: number): bigint {
  if (tier >= MAX_TIER) throw new RangeError(`tier ${tier} is already the maximum`);
  const delta = BigInt(cumulativeBps(tier + 1) - cumulativeBps(tier));
  return (denominationWei(collection, gen) * delta) / 10_000n;
}

export function upgradeCostRf(collection: Collection, gen: number, tier: number): number {
  return weiToRf(upgradeCostWei(collection, gen, tier));
}

/** activate(collection, id): a tenth of the denomination (Genesis: 100,000 RF). */
export function activateCostWei(collection: Collection, gen: number): bigint {
  return denominationWei(collection, gen) / 10n;
}

export function activateCostRf(collection: Collection, gen: number): number {
  return weiToRf(activateCostWei(collection, gen));
}

/**
 * Active weight in RF units.
 * Generations: denomination x cumBps[tier] x (GENERATION_WEIGHT_BPS[gen] + tier x (gen 1 ? 500 : 250)) / 1e8.
 * Genesis: flat 2,000,000 when active.
 */
export function weightFor(collection: Collection, gen: number, tier: number): number {
  if (collection === "Genesis") return GENESIS_WEIGHT;
  assertGeneration(gen);
  const genBps = GENERATION_WEIGHT_BPS[gen];
  if (genBps === undefined) throw new RangeError(`no weight bps for generation ${gen}`);
  const tierBonus = tier * (gen === 1 ? 500 : 250);
  // Integer product stays below 2^53 (max 1e5 x 50,625 x 18,500 = 9.4e13), so the division is exact-ish.
  return (denominationRf(collection, gen) * cumulativeBps(tier) * (genBps + tierBonus)) / 1e8;
}

/** RF earned per week by `weight` when `streamAmountRf` is streamed over 7 days to `totalWeightRf`. */
export function weeklyRfFor(weight: number, totalWeightRf: number, streamAmountRf: number): number {
  if (!(totalWeightRf > 0) || !(weight > 0) || !(streamAmountRf > 0)) return 0;
  return (streamAmountRf * weight) / totalWeightRf;
}

/** Weeks until the weekly gain repays the cost; null when there is no gain. */
export function breakEvenWeeks(costRf: number, weeklyGainRf: number): number | null {
  if (!(weeklyGainRf > 0) || !Number.isFinite(weeklyGainRf)) return null;
  if (!(costRf > 0)) return 0;
  return costRf / weeklyGainRf;
}

export interface BurnSplit {
  burnRf: number;
  toRewardsRf: number;
}

/** Every paid action burns BURN_SHARE and streams the rest to active Friends. */
export function burnSplit(costRf: number): BurnSplit {
  const burnRf = costRf * BURN_SHARE;
  return { burnRf, toRewardsRf: costRf - burnRf };
}

/**
 * Protocol rule: `hardwire(g)` reverts with UnexpectedGeneration unless g is the highest
 * generation the wallet's live RF balance can afford (Gen 1 = 100,000 RF ... Gen 6 = 1 RF).
 * Returns null when the balance is below 1 RF.
 */
export function hardwireGenerationFor(balanceWei: bigint): number | null {
  for (let gen = 1; gen <= 6; gen++) if (balanceWei >= hardwireCostWei(gen)) return gen;
  return null;
}
