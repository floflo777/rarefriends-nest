import { describe, expect, it } from "vitest";
import type { Friend, ProtocolState } from "../types.js";
import { computeVitals, moodFromWeight, savingsScale } from "../vitals.js";

const RF = 10n ** 18n;
const OWNER = "0x1111111111111111111111111111111111111111" as const;
const WALLET = "0x2222222222222222222222222222222222222222" as const;

function friendGen1Tier2(): Friend {
  return {
    collection: "Generations",
    tokenId: 1969n,
    owner: OWNER,
    wallet: WALLET,
    generation: 1,
    family: 4,
    familyName: "Asymmetry",
    seed: 1969,
    position: { tier: 2, weight: 416_250n * RF, active: true },
    rewards: { earnedRf: 36_189n * RF, earnedWeth: 0n },
    savings: { rf: 1_000n * RF, weth: 1n * RF, eth: 0n },
  };
}

const NOW = 1_790_000_000;

function state(): ProtocolState {
  return {
    blockNumber: 76_460_000n,
    timestamp: NOW,
    // 1,068,713,093.63 weight and 8,547,984.3 RF as wei
    totalWeight: 106_871_309_363n * 10n ** 16n,
    rfStream: { amount: 85_479_843n * 10n ** 17n, periodFinish: NOW + 3 * 86_400, lastUpdate: NOW - 3600 },
    wethStream: { amount: 163n * 10n ** 16n, periodFinish: NOW + 3 * 86_400, lastUpdate: NOW - 3600 },
    rfTotalSupply: 947_000_000n * RF,
  };
}

describe("computeVitals", () => {
  it("Gen-1 tier-2 with 36,189 RF unclaimed: weekly income ~3,329 RF, hunger clamps to 1", () => {
    const v = computeVitals(friendGen1Tier2(), state(), NOW);
    expect(v.weeklyRfFromStream).toBeGreaterThan(3_320);
    expect(v.weeklyRfFromStream).toBeLessThan(3_340);
    expect(v.streamShare).toBeCloseTo(416_250 / 1_068_713_093.63, 9);
    expect(v.hunger).toBe(1);
    expect(v.strength).toBe(0.5);
    expect(v.territory).toBe(1);
    expect(v.awake).toBe(true);
    expect(v.mood).toBeGreaterThan(0.9);
    expect(v.mood).toBeLessThanOrEqual(1);
    // 1,000 RF of savings, WETH ignored without a rate
    expect(v.savings).toBeCloseTo(savingsScale(1_000), 12);
  });

  it("hunger scales linearly below one week of income", () => {
    const f = friendGen1Tier2();
    f.rewards.earnedRf = 1_664n * RF; // about half a week
    const v = computeVitals(f, state(), NOW);
    expect(v.hunger).toBeGreaterThan(0.48);
    expect(v.hunger).toBeLessThan(0.52);
    f.rewards.earnedRf = 0n;
    expect(computeVitals(f, state(), NOW).hunger).toBe(0);
  });

  it("zero income: hunger is 1 with anything unclaimed, else 0; inactive Friend is asleep", () => {
    const f = friendGen1Tier2();
    f.position = { tier: 0, weight: 0n, active: false };
    const v = computeVitals(f, state(), NOW);
    expect(v.weeklyRfFromStream).toBe(0);
    expect(v.streamShare).toBe(0);
    expect(v.hunger).toBe(1);
    expect(v.awake).toBe(false);
    expect(v.mood).toBe(0);
    f.rewards.earnedRf = 0n;
    expect(computeVitals(f, state(), NOW).hunger).toBe(0);
  });

  it("a finished stream period pays nothing", () => {
    const s = state();
    s.rfStream.periodFinish = NOW - 1;
    const v = computeVitals(friendGen1Tier2(), s, NOW);
    expect(v.weeklyRfFromStream).toBe(0);
    expect(v.hunger).toBe(1);
  });

  it("territory and strength follow generation and tier; Genesis is full territory", () => {
    const f = friendGen1Tier2();
    f.generation = 6;
    f.position.tier = 0;
    const pup = computeVitals(f, state(), NOW);
    expect(pup.territory).toBeCloseTo(1 / 6, 12);
    expect(pup.strength).toBe(0);
    f.collection = "Genesis";
    f.generation = 0;
    f.position.tier = 4;
    const genesis = computeVitals(f, state(), NOW);
    expect(genesis.territory).toBe(1);
    expect(genesis.strength).toBe(1);
  });

  it("mood is 0.5 for a Gen-6 tier-0 pup and increases with weight", () => {
    expect(moodFromWeight(11n * 10n ** 17n)).toBeCloseTo(0.5, 12);
    const gen5 = moodFromWeight(12n * RF);
    const gen1 = moodFromWeight(175_000n * RF);
    const genesis = moodFromWeight(2_000_000n * RF);
    expect(gen5).toBeGreaterThan(0.5);
    expect(gen1).toBeGreaterThan(gen5);
    expect(genesis).toBeGreaterThan(gen1);
    expect(genesis).toBeLessThan(1);
  });

  it("savings counts WETH only when a rate is given", () => {
    const f = friendGen1Tier2();
    const without = computeVitals(f, state(), NOW);
    const withRate = computeVitals(f, state(), NOW, 5_000_000);
    expect(withRate.savings).toBeGreaterThan(without.savings);
    expect(withRate.savings).toBeCloseTo(savingsScale(1_000 + 5_000_000), 12);
    expect(savingsScale(0)).toBe(0);
    expect(savingsScale(1_000_000)).toBe(1);
    expect(savingsScale(1e12)).toBe(1);
  });
});
