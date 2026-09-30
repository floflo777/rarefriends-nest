/**
 * The Steward: for every Friend in a household, every protocol action with its exact
 * cost, burn, weight delta, weekly RF at the current stream and break-even. Pure: no
 * chain access, no transaction sent. Calldata is prepared for the wallet to sign.
 */
import { encodeFunctionData } from "viem";
import type { Address, Hex } from "viem";
import type { Friend, Household, PreparedTx, ProtocolState, StewardAction, StewardActionKind } from "../types.js";
import { ACTIVATION_MANAGER_ABI, ADDRESSES, ERC20_ABI } from "../protocol/constants.js";
import {
  MAX_TIER,
  activateCostWei,
  breakEvenWeeks,
  burnSplit,
  hardwireCostWei,
  promoteCostWei,
  upgradeCostWei,
  weeklyRfFor,
  weiToRf,
  weightFor,
  hardwireGenerationFor,
  hardwireCostRf,
} from "../protocol/math.js";
import { collectionAddress } from "../chain/reads.js";

export interface PlanOptions {
  /** Include free claim actions (default true). */
  includeClaims?: boolean;
  /** Drop paid actions the household cannot afford with its RF balance (default false). */
  onlyAffordable?: boolean;
}

const AM: Address = ADDRESSES.activationManager;

function approveTx(costWei: bigint): PreparedTx {
  return {
    to: ADDRESSES.rf,
    data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [AM, costWei] }),
    value: 0n,
    description: `Approve ActivationManager to pull ${weiToRf(costWei)} RF`,
  };
}

function actionTx(data: Hex, description: string): PreparedTx {
  return { to: AM, data, value: 0n, description };
}

function formatWeeks(weeks: number): string {
  return weeks < 10 ? weeks.toFixed(1) : Math.round(weeks).toString();
}

function rationaleFor(kind: StewardActionKind, weeks: number | null, gainRf: number): string {
  if (weeks === null) {
    return kind === "hatch"
      ? "1 RF hatches the egg into a Gen-6 pup; its weight is too small to earn anything measurable, so this is about growing the household."
      : "No measurable weekly gain at the current stream: this spend is for the Friend, not for yield.";
  }
  const base = `Pays for itself in ${formatWeeks(weeks)} weeks at the current stream`;
  if (weeks <= 12) return `${base}: cheap for what it adds (${gainRf.toFixed(1)} RF a week).`;
  if (weeks <= 52) return `${base}: a long-horizon bet that only works if the stream holds.`;
  return `${base}: this is a collector's spend, not a yield play.`;
}

interface PaidActionInput {
  kind: StewardActionKind;
  friend?: Friend;
  label: string;
  costWei: bigint;
  currentWeight: number;
  newWeight: number;
  data: Hex;
  description: string;
}

function paidAction(input: PaidActionInput, household: Household, totalWeightRf: number, streamRf: number): StewardAction {
  const costRf = weiToRf(input.costWei);
  const deltaWeight = input.newWeight - input.currentWeight;
  const weeklyBefore = weeklyRfFor(input.currentWeight, totalWeightRf, streamRf);
  const weeklyAfter = weeklyRfFor(input.newWeight, totalWeightRf + deltaWeight, streamRf);
  const weeklyRfGain = Math.max(0, weeklyAfter - weeklyBefore);
  const weeks = breakEvenWeeks(costRf, weeklyRfGain);
  const txs: PreparedTx[] = [];
  if (household.rfAllowance < input.costWei) txs.push(approveTx(input.costWei));
  txs.push(actionTx(input.data, input.description));
  const { burnRf, toRewardsRf } = burnSplit(costRf);
  const action: StewardAction = {
    kind: input.kind,
    label: input.label,
    costRf,
    burnRf,
    toRewardsRf,
    deltaWeight,
    weeklyRfGain,
    breakEvenWeeks: weeks,
    txs,
    rationale: rationaleFor(input.kind, weeks, weeklyRfGain),
  };
  if (input.friend !== undefined) action.friend = input.friend;
  return action;
}

function claimAction(friend: Friend): StewardAction | null {
  const collection = collectionAddress(friend.collection);
  const txs: PreparedTx[] = [];
  const parts: string[] = [];
  if (friend.rewards.earnedRf > 0n) {
    txs.push(
      actionTx(
        encodeFunctionData({ abi: ACTIVATION_MANAGER_ABI, functionName: "claim", args: [ADDRESSES.rf, collection, friend.tokenId] }),
        `Claim ${weiToRf(friend.rewards.earnedRf).toFixed(4)} RF into the Friend's wallet`,
      ),
    );
    parts.push(`${weiToRf(friend.rewards.earnedRf).toFixed(2)} RF`);
  }
  if (friend.rewards.earnedWeth > 0n) {
    txs.push(
      actionTx(
        encodeFunctionData({ abi: ACTIVATION_MANAGER_ABI, functionName: "claim", args: [ADDRESSES.weth, collection, friend.tokenId] }),
        `Claim ${weiToRf(friend.rewards.earnedWeth).toFixed(6)} WETH into the Friend's wallet`,
      ),
    );
    parts.push(`${weiToRf(friend.rewards.earnedWeth).toFixed(6)} WETH`);
  }
  if (txs.length === 0) return null;
  return {
    kind: "claim",
    friend,
    label: `Feed #${friend.tokenId}`,
    costRf: 0,
    burnRf: 0,
    toRewardsRf: 0,
    deltaWeight: 0,
    weeklyRfGain: 0,
    breakEvenWeeks: null,
    txs,
    rationale: `Free: moves ${parts.join(" and ")} of unclaimed rewards into the Friend's own wallet (gas only).`,
  };
}

function friendActions(friend: Friend, household: Household, totalWeightRf: number, streamRf: number): StewardAction[] {
  const out: StewardAction[] = [];
  const collection = collectionAddress(friend.collection);
  const currentWeight = weiToRf(friend.position.weight);
  const { tier } = friend.position;
  const gen = friend.generation;

  if (!friend.position.active) {
    out.push(
      paidAction(
        {
          kind: "wake",
          friend,
          label: `Wake #${friend.tokenId}`,
          costWei: activateCostWei(friend.collection, gen),
          currentWeight,
          newWeight: weightFor(friend.collection, gen, tier),
          data: encodeFunctionData({ abi: ACTIVATION_MANAGER_ABI, functionName: "activate", args: [collection, friend.tokenId] }),
          description: `activate(${friend.collection}, #${friend.tokenId})`,
        },
        household,
        totalWeightRf,
        streamRf,
      ),
    );
  }

  if (friend.collection === "Generations") {
    if (friend.position.active && tier < MAX_TIER) {
      out.push(
        paidAction(
          {
            kind: "train",
            friend,
            label: `Train #${friend.tokenId} to tier ${tier + 1}`,
            costWei: upgradeCostWei("Generations", gen, tier),
            currentWeight,
            newWeight: weightFor("Generations", gen, tier + 1),
            data: encodeFunctionData({ abi: ACTIVATION_MANAGER_ABI, functionName: "upgrade", args: [collection, friend.tokenId] }),
            description: `upgrade(Generations, #${friend.tokenId}) tier ${tier} -> ${tier + 1}`,
          },
          household,
          totalWeightRf,
          streamRf,
        ),
      );
    }
    if (gen > 1) {
      // Protocol rule (docs "Promote"): the Friend resets to tier 0 of the new generation and
      // previous upgrade payments are not refunded. An inactive Friend gains no weight until woken.
      out.push(
        paidAction(
          {
            kind: "raise",
            friend,
            label: `Raise #${friend.tokenId} to Gen ${gen - 1}${tier > 0 ? ` (tier resets to 0)` : ""}`,
            costWei: promoteCostWei(gen),
            currentWeight,
            newWeight: friend.position.active ? weightFor("Generations", gen - 1, 0) : currentWeight,
            data: encodeFunctionData({ abi: ACTIVATION_MANAGER_ABI, functionName: "promote", args: [friend.tokenId] }),
            description: `promote(#${friend.tokenId}) Gen ${gen} -> ${gen - 1}`,
          },
          household,
          totalWeightRf,
          streamRf,
        ),
      );
    }
  }
  return out;
}

function hatchAction(household: Household, totalWeightRf: number, streamRf: number): StewardAction | null {
  if (household.eggTokenId === null) return null;
  const gen = hardwireGenerationFor(household.rfBalance);
  if (gen === null) return null;
  const costWei = hardwireCostWei(gen);
  const action = paidAction(
    {
      kind: "hatch",
      label: `Hatch egg #${household.eggTokenId} as Gen-${gen}`,
      costWei,
      currentWeight: 0,
      newWeight: weightFor("Generations", gen, 0),
      data: encodeFunctionData({ abi: ACTIVATION_MANAGER_ABI, functionName: "hardwire", args: [gen] }),
      description: `hardwire(${gen}): ${hardwireCostRf(gen).toLocaleString("en-US")} RF, half burned, the egg becomes a Gen-${gen} Friend`,
    },
    household,
    totalWeightRf,
    streamRf,
  );
  action.hatchGeneration = gen;
  action.rationale = `${action.rationale} Your wallet balance selects the generation: ${weiToRf(household.rfBalance).toLocaleString("en-US", { maximumFractionDigits: 2 })} RF makes this egg a Gen-${gen}.`;
  return action;
}

/**
 * When the balance would hatch an expensive generation, offer to park RF in a pet's own wallet
 * first (a plain RF transfer the owner controls through the ERC-6551 account), so the next egg
 * hatches as a cheaper pup. Suggests parking down to just under the next denomination.
 */
function saveAction(household: Household, hatchGen: number): StewardAction | null {
  if (hatchGen >= 6 || household.eggTokenId === null) return null;
  const target = household.friends.find((f) => f.collection === "Generations" && f.position.active) ?? household.friends[0];
  if (!target) return null;
  const keepWei = hardwireCostWei(hatchGen) - 1n; // just under the current generation's price, so the next egg is one generation cheaper
  const parkWei = household.rfBalance - keepWei;
  if (parkWei <= 0n) return null;
  const parkRf = weiToRf(parkWei);
  return {
    kind: "save",
    friend: target,
    label: `Save ${parkRf.toLocaleString("en-US", { maximumFractionDigits: 2 })} RF into #${target.tokenId}'s wallet`,
    costRf: 0,
    burnRf: 0,
    toRewardsRf: 0,
    deltaWeight: 0,
    weeklyRfGain: 0,
    breakEvenWeeks: null,
    txs: [
      {
        to: ADDRESSES.rf,
        data: encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [target.wallet, parkWei] }),
        value: 0n,
        description: `transfer ${parkRf.toLocaleString("en-US", { maximumFractionDigits: 2 })} RF to the Friend's own wallet (still yours, withdrawable)`,
      },
    ],
    rationale: `Not a spend: the RF stays in a wallet you control. With ${weiToRf(household.rfBalance).toLocaleString("en-US", { maximumFractionDigits: 2 })} RF in hand the egg hatches as Gen-${hatchGen} for ${hardwireCostRf(hatchGen).toLocaleString("en-US")} RF; after saving, the next egg hatches as Gen-${hatchGen + 1} for ${hardwireCostRf(hatchGen + 1).toLocaleString("en-US")} RF.`,
  };
}

function compareActions(a: StewardAction, b: StewardAction): number {
  if (a.kind === "claim" !== (b.kind === "claim")) return a.kind === "claim" ? -1 : 1;
  if (a.breakEvenWeeks === null || b.breakEvenWeeks === null) {
    if (a.breakEvenWeeks === b.breakEvenWeeks) return 0;
    return a.breakEvenWeeks === null ? 1 : -1;
  }
  return a.breakEvenWeeks - b.breakEvenWeeks;
}

/** Every action available to the household, claims first, then by break-even ascending (nulls last). */
export function planHousehold(household: Household, state: ProtocolState, options: PlanOptions = {}): StewardAction[] {
  const totalWeightRf = weiToRf(state.totalWeight);
  const streamRf = weiToRf(state.rfStream.amount);
  const actions: StewardAction[] = [];
  for (const friend of household.friends) {
    if (options.includeClaims !== false) {
      const claim = claimAction(friend);
      if (claim !== null) actions.push(claim);
    }
    actions.push(...friendActions(friend, household, totalWeightRf, streamRf));
  }
  const hatch = hatchAction(household, totalWeightRf, streamRf);
  if (hatch !== null) {
    actions.push(hatch);
    const save = saveAction(household, hatch.hatchGeneration ?? 6);
    if (save !== null) actions.push(save);
  }
  const affordable = options.onlyAffordable === true ? actions.filter((a) => a.costRf === 0 || household.rfBalance >= rfCeilWei(a.costRf)) : actions;
  return affordable.sort(compareActions);
}

function rfCeilWei(costRf: number): bigint {
  return BigInt(Math.ceil(costRf * 1e6)) * 10n ** 12n;
}
