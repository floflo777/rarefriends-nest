import { describe, expect, it } from "vitest";
import { decodeFunctionData, getAddress } from "viem";
import type { Address } from "viem";
import type { Friend, Household, ProtocolState } from "../../types.js";
import { ACTION_SELECTORS, ACTIVATION_MANAGER_ABI, ADDRESSES, ERC20_ABI } from "../../protocol/constants.js";
import { rfToWei, weightFor } from "../../protocol/math.js";
import { planHousehold } from "../planner.js";

const OWNER = "0x3d35A856cb96f9770c986841f4fdB7e198A272Cb" as Address;
const WALLET = "0x4e0a44603D1f182E4C21c9CB24fcc4cBAeb1FE3b" as Address;

const state: ProtocolState = {
  blockNumber: 76_467_186n,
  timestamp: 1_790_770_000,
  totalWeight: rfToWei(1_068_713_093.63),
  rfStream: { amount: rfToWei(8_547_984.3), periodFinish: 1_790_780_946, lastUpdate: 1_790_766_265 },
  wethStream: { amount: 1_629_148_557_858_042_776n, periodFinish: 1_790_780_947, lastUpdate: 1_790_766_265 },
  rfTotalSupply: 947_734_649_066_837_858_865_375_706n,
};

function friend(partial: Partial<Friend> & Pick<Friend, "tokenId" | "collection" | "generation">): Friend {
  const tier = partial.position?.tier ?? 0;
  const active = partial.position?.active ?? true;
  const weight = active ? rfToWei(weightFor(partial.collection, partial.generation, tier)) : 0n;
  return {
    owner: OWNER,
    wallet: WALLET,
    position: { tier, weight, active },
    rewards: { earnedRf: 0n, earnedWeth: 0n },
    savings: { rf: 0n, weth: 0n, eth: 0n },
    ...partial,
  };
}

const pup = friend({ collection: "Generations", tokenId: 500_000n, generation: 6, rewards: { earnedRf: 12n * 10n ** 15n, earnedWeth: 0n } });
const elder = friend({ collection: "Generations", tokenId: 1969n, generation: 1, position: { tier: 2, weight: rfToWei(416_250), active: true } });
const sleeper = friend({ collection: "Genesis", tokenId: 597n, generation: 0, position: { tier: 0, weight: 0n, active: false } });

const household: Household = {
  owner: OWNER,
  friends: [pup, elder, sleeper],
  eggTokenId: 600_001n,
  rfBalance: rfToWei(250_000),
  rfAllowance: 0n,
};

describe("planHousehold", () => {
  const plan = planHousehold(household, state);

  it("enumerates claim, train, raise, wake and one hatch", () => {
    const kinds = plan.map((a) => `${a.kind}:${a.friend?.tokenId ?? "egg"}`);
    expect(kinds).toContain("claim:500000");
    expect(kinds).toContain("train:500000");
    expect(kinds).toContain("raise:500000");
    expect(kinds).toContain("train:1969");
    expect(kinds).not.toContain("raise:1969");
    expect(kinds).toContain("wake:597");
    expect(kinds.filter((k) => k.startsWith("hatch"))).toEqual(["hatch:egg"]);
    expect(kinds).not.toContain("train:597");
  });

  it("puts claims first, then break-even ascending, nulls last", () => {
    expect(plan[0]?.kind).toBe("claim");
    const paid = plan.filter((a) => a.kind !== "claim");
    const weeks = paid.map((a) => a.breakEvenWeeks);
    const numeric = weeks.filter((w): w is number => w !== null);
    expect(numeric).toEqual([...numeric].sort((a, b) => a - b));
    const firstNull = weeks.indexOf(null);
    if (firstNull >= 0) expect(weeks.slice(firstNull).every((w) => w === null)).toBe(true);
  });

  it("Genesis wake: 100,000 RF, 50,000 burned, weight +2,000,000, about 6.3 weeks", () => {
    const wake = plan.find((a) => a.kind === "wake");
    expect(wake).toBeDefined();
    expect(wake?.costRf).toBe(100_000);
    expect(wake?.burnRf).toBe(50_000);
    expect(wake?.toRewardsRf).toBe(50_000);
    expect(wake?.deltaWeight).toBe(2_000_000);
    expect(Math.abs((wake?.breakEvenWeeks ?? 0) - 6.3)).toBeLessThan(0.1);
    expect(wake?.rationale).toMatch(/Pays for itself in 6\.\d weeks/);
  });

  it("Gen-6 train: 0.5 RF, +0.5875 weight, about 106 weeks, honest rationale", () => {
    const train = plan.find((a) => a.kind === "train" && a.friend?.tokenId === 500_000n);
    expect(train?.costRf).toBe(0.5);
    expect(train?.deltaWeight).toBeCloseTo(0.5875, 9);
    expect(Math.abs((train?.breakEvenWeeks ?? 0) - 106.4)).toBeLessThan(0.1);
    expect(train?.rationale).toContain("collector's spend, not a yield play");
  });

  it("Gen-6 raise to Gen-5: 9 RF, weight 1.1 -> 12", () => {
    const raise = plan.find((a) => a.kind === "raise" && a.friend?.tokenId === 500_000n);
    expect(raise?.costRf).toBe(9);
    expect(raise?.deltaWeight).toBeCloseTo(12 - 1.1, 9);
    expect(raise?.label).toBe("Raise #500000 to Gen 5");
  });

  it("prepends an approve when the allowance is short and encodes the right selectors", () => {
    const train = plan.find((a) => a.kind === "train" && a.friend?.tokenId === 1969n);
    expect(train?.txs).toHaveLength(2);
    const [approve, action] = train?.txs ?? [];
    expect(approve?.to).toBe(ADDRESSES.rf);
    const decoded = decodeFunctionData({ abi: ERC20_ABI, data: approve?.data ?? "0x" });
    expect(decoded.functionName).toBe("approve");
    expect(decoded.args).toEqual([getAddress(ADDRESSES.activationManager), rfToWei(112_500)]);
    expect(action?.to).toBe(ADDRESSES.activationManager);
    expect(ACTION_SELECTORS[action?.data.slice(0, 10) as keyof typeof ACTION_SELECTORS]).toBe("upgrade");
    const call = decodeFunctionData({ abi: ACTIVATION_MANAGER_ABI, data: action?.data ?? "0x" });
    expect(call.args).toEqual([getAddress(ADDRESSES.generations), 1969n]);
  });

  it("every paid action's calldata selector is a known protocol action", () => {
    const expected: Record<string, string> = { train: "upgrade", raise: "promote", wake: "activate", hatch: "hardwire", claim: "claim" };
    for (const action of plan) {
      const last = action.txs.at(-1);
      const selector = last?.data.slice(0, 10) as keyof typeof ACTION_SELECTORS;
      expect(ACTION_SELECTORS[selector]).toBe(expected[action.kind]);
      for (const tx of action.txs) expect(tx.value).toBe(0n);
    }
  });

  it("skips approve when the allowance covers the cost", () => {
    const rich = planHousehold({ ...household, rfAllowance: rfToWei(1_000_000) }, state);
    for (const action of rich) expect(action.txs).toHaveLength(action.kind === "claim" ? 1 : 1);
  });

  it("claim is free and moves the earned RF", () => {
    const claim = plan.find((a) => a.kind === "claim");
    expect(claim?.costRf).toBe(0);
    expect(claim?.breakEvenWeeks).toBeNull();
    expect(claim?.txs).toHaveLength(1);
    expect(claim?.rationale).toContain("0.01 RF");
  });

  it("no egg or no RF means no hatch; onlyAffordable drops the Genesis wake", () => {
    expect(planHousehold({ ...household, eggTokenId: null }, state).some((a) => a.kind === "hatch")).toBe(false);
    expect(planHousehold({ ...household, rfBalance: 0n }, state).some((a) => a.kind === "hatch")).toBe(false);
    const poor = planHousehold({ ...household, rfBalance: rfToWei(10) }, state, { onlyAffordable: true });
    expect(poor.some((a) => a.kind === "wake")).toBe(false);
    expect(poor.some((a) => a.kind === "train" && a.friend?.tokenId === 500_000n)).toBe(true);
    expect(planHousehold(household, state, { includeClaims: false }).some((a) => a.kind === "claim")).toBe(false);
  });

  it("an inactive Generations Friend gets a wake at denomination / 10", () => {
    const asleep = friend({ collection: "Generations", tokenId: 7n, generation: 4, position: { tier: 1, weight: 0n, active: false } });
    const actions = planHousehold({ ...household, friends: [asleep] }, state);
    const wake = actions.find((a) => a.kind === "wake");
    expect(wake?.costRf).toBe(10);
    expect(wake?.deltaWeight).toBeCloseTo(198.75, 9);
    expect(actions.some((a) => a.kind === "train")).toBe(false);
  });
});

describe("hatch generation follows the wallet balance (protocol rule UnexpectedGeneration)", () => {
  it("250,000 RF hatches a Gen-1 for 100,000 RF and offers to save RF first", () => {
    const plan = planHousehold(household, state);
    const hatch = plan.find((a) => a.kind === "hatch");
    expect(hatch?.hatchGeneration).toBe(1);
    expect(hatch?.costRf).toBe(100_000);
    expect(hatch?.txs.at(-1)?.description).toContain("hardwire(1)");
    const save = plan.find((a) => a.kind === "save");
    expect(save).toBeDefined();
    expect(save?.costRf).toBe(0);
    expect(save?.rationale).toContain("Gen-2");
  });
  it("250 RF hatches a Gen-4 for 100 RF; 5 RF hatches a Gen-6 for 1 RF with no save suggestion", () => {
    const mid = planHousehold({ ...household, rfBalance: rfToWei(250) }, state);
    expect(mid.find((a) => a.kind === "hatch")?.hatchGeneration).toBe(4);
    expect(mid.find((a) => a.kind === "hatch")?.costRf).toBe(100);
    expect(mid.find((a) => a.kind === "save")?.label).toMatch(/Save 150(\.\d+)? RF/);
    const poor = planHousehold({ ...household, rfBalance: rfToWei(5) }, state);
    expect(poor.find((a) => a.kind === "hatch")?.hatchGeneration).toBe(6);
    expect(poor.find((a) => a.kind === "hatch")?.costRf).toBe(1);
    expect(poor.some((a) => a.kind === "save")).toBe(false);
  });
});
