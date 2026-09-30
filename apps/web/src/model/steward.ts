/**
 * Care actions and their economics, computed locally until packages/core's steward
 * planner lands. Cost rules come from the protocol docs cross-checked in design.md:
 *  - Feed  = claim: free.
 *  - Train = upgrade: denomination x (cumulativeBps[t+1] - cumulativeBps[t]) / 1e4.
 *  - Raise = promote: denomination(g-1) - denomination(g) (6->5 costs 9 RF; the 6->1 ladder ~100k).
 *  - Wake  = activate (Genesis): 100,000 RF for 2,000,000 weight (~6 weeks break-even).
 *  - Hatch = hardwire(6): 1 RF.
 * Delta weight for Train uses the Friend's real weight and the tier ratio, so it does not
 * depend on the generation multiplier table.
 */
import {
  BURN_SHARE,
  DENOMINATION_RF,
  GENERATION_WEIGHT_BPS,
  GENESIS_ACTIVATION_RF,
  GENESIS_DENOMINATION_RF,
  GENESIS_WEIGHT,
  TIER_CUMULATIVE_BPS,
  type Friend,
  type Household,
  type ProtocolState,
  type StewardAction,
  type StewardActionKind,
} from "@nest/core";
import { toUnits } from "./format.js";

export const ACTION_LABEL: Record<StewardActionKind, string> = {
  claim: "FEED",
  train: "TRAIN",
  raise: "RAISE",
  wake: "WAKE",
  hatch: "HATCH",
  save: "SAVE",
};

export interface StewardContext {
  protocol: ProtocolState | null;
  household: Household | null;
}

function weeklyGain(deltaWeight: number, protocol: ProtocolState | null): number {
  if (!protocol) return 0;
  const total = toUnits(protocol.totalWeight);
  const stream = toUnits(protocol.rfStream.amount);
  if (total + deltaWeight <= 0) return 0;
  return (deltaWeight / (total + deltaWeight)) * stream;
}

function build(kind: StewardActionKind, friend: Friend | undefined, costRf: number, deltaWeight: number, rationale: string, ctx: StewardContext): StewardAction {
  const gain = weeklyGain(deltaWeight, ctx.protocol);
  const action: StewardAction = {
    kind,
    label: ACTION_LABEL[kind],
    costRf,
    burnRf: costRf * BURN_SHARE,
    toRewardsRf: costRf * (1 - BURN_SHARE),
    deltaWeight,
    weeklyRfGain: gain,
    breakEvenWeeks: gain > 0 && costRf > 0 ? costRf / gain : null,
    txs: [],
    rationale,
  };
  if (friend) action.friend = friend;
  return action;
}

function denominationOf(friend: Friend): number {
  return friend.collection === "Genesis" ? GENESIS_DENOMINATION_RF : (DENOMINATION_RF[friend.generation] ?? 0);
}

/** Actions applicable to one Friend, in menu order, plus Hatch when the household has an egg. */
export function careActions(friend: Friend | null, ctx: StewardContext): StewardAction[] {
  const out: StewardAction[] = [];
  if (friend) {
    const weight = toUnits(friend.position.weight);
    const tier = friend.position.tier;
    if (friend.rewards.earnedRf > 0n || friend.rewards.earnedWeth > 0n) {
      out.push(build("claim", friend, 0, 0, "Claim unclaimed RF and WETH into the Friend's wallet.", ctx));
    }
    if (friend.position.active && tier < TIER_CUMULATIVE_BPS.length - 1) {
      const cur = TIER_CUMULATIVE_BPS[tier] ?? 10_000;
      const next = TIER_CUMULATIVE_BPS[tier + 1] ?? cur;
      const cost = (denominationOf(friend) * (next - cur)) / 10_000;
      out.push(build("train", friend, cost, weight * (next / cur - 1), `Upgrade tier ${tier} -> ${tier + 1}.`, ctx));
    }
    if (friend.collection === "Generations" && friend.generation > 1 && friend.position.active) {
      const g = friend.generation;
      const cost = (DENOMINATION_RF[g - 1] ?? 0) - (DENOMINATION_RF[g] ?? 0);
      const factor = ((DENOMINATION_RF[g - 1] ?? 0) * (GENERATION_WEIGHT_BPS[g - 1] ?? 0)) / ((DENOMINATION_RF[g] ?? 1) * (GENERATION_WEIGHT_BPS[g] ?? 1));
      out.push(build("raise", friend, cost, weight * (factor - 1), `Promote generation ${g} -> ${g - 1}.`, ctx));
    }
    if (friend.collection === "Genesis" && !friend.position.active) {
      out.push(build("wake", friend, GENESIS_ACTIVATION_RF, GENESIS_WEIGHT, "Activate this Genesis Friend.", ctx));
    }
  }
  if (ctx.household?.eggTokenId) {
    const gen6 = (DENOMINATION_RF[6] ?? 1) * ((GENERATION_WEIGHT_BPS[6] ?? 10_000) / 10_000);
    out.push(build("hatch", undefined, DENOMINATION_RF[6] ?? 1, gen6, "Hardwire the egg as a generation 6 pup.", ctx));
  }
  return out;
}
