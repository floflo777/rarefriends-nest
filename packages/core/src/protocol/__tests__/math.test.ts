import { describe, expect, it } from "vitest";
import {
  activateCostRf,
  activateCostWei,
  breakEvenWeeks,
  burnSplit,
  hardwireCostRf,
  promoteCostRf,
  promoteCostWei,
  rfToWei,
  upgradeCostRf,
  upgradeCostWei,
  weeklyRfFor,
  weiToRf,
  weightFor,
} from "../math.js";

/** Live reference read on 2026-09-30. */
const TOTAL_WEIGHT_RF = 1_068_713_093.63;
const RF_STREAM_RF = 8_547_984.3;

describe("weights", () => {
  it.each([
    [4, 1, 198.75],
    [1, 2, 416_250],
    [1, 0, 175_000],
    [6, 0, 1.1],
    [6, 4, 6.075],
    [3, 4, 7_846.875],
  ])("Generations gen %i tier %i weighs %f", (gen, tier, expected) => {
    expect(weightFor("Generations", gen, tier)).toBeCloseTo(expected, 9);
  });

  it("Genesis active weight is flat 2,000,000", () => {
    expect(weightFor("Genesis", 0, 0)).toBe(2_000_000);
    expect(weightFor("Genesis", 0, 3)).toBe(2_000_000);
  });

  it("rejects out-of-range generations and tiers", () => {
    expect(() => weightFor("Generations", 0, 0)).toThrow(RangeError);
    expect(() => weightFor("Generations", 7, 0)).toThrow(RangeError);
    expect(() => weightFor("Generations", 3, 5)).toThrow(RangeError);
  });
});

describe("costs", () => {
  it("hardwire = denomination", () => {
    expect(hardwireCostRf(6)).toBe(1);
    expect(hardwireCostRf(1)).toBe(100_000);
  });
  it("promote pays the denomination difference", () => {
    expect(promoteCostRf(4)).toBe(900);
    expect(promoteCostRf(6)).toBe(9);
    expect(promoteCostWei(6)).toBe(9n * 10n ** 18n);
    expect(() => promoteCostRf(1)).toThrow(RangeError);
  });
  it("upgrade = denomination x bps step / 10000", () => {
    expect(upgradeCostRf("Generations", 4, 1)).toBe(75);
    expect(upgradeCostRf("Generations", 6, 0)).toBe(0.5);
    expect(upgradeCostWei("Generations", 6, 0)).toBe(5n * 10n ** 17n);
    expect(() => upgradeCostRf("Generations", 6, 4)).toThrow(RangeError);
  });
  it("activate = denomination / 10", () => {
    expect(activateCostRf("Genesis", 0)).toBe(100_000);
    expect(activateCostWei("Genesis", 0)).toBe(100_000n * 10n ** 18n);
    expect(activateCostRf("Generations", 6)).toBe(0.1);
  });
  it("burn split is 50/50", () => {
    expect(burnSplit(900)).toEqual({ burnRf: 450, toRewardsRf: 450 });
  });
});

describe("stream economics (live reference 2026-09-30)", () => {
  it("Gen-6 tier 0 -> 1 breaks even in about 106 weeks", () => {
    const delta = weightFor("Generations", 6, 1) - weightFor("Generations", 6, 0);
    const weekly = weeklyRfFor(delta, TOTAL_WEIGHT_RF, RF_STREAM_RF);
    const weeks = breakEvenWeeks(upgradeCostRf("Generations", 6, 0), weekly);
    expect(weeks).not.toBeNull();
    expect(weeks ?? 0).toBeCloseTo(106.4, 0);
    expect(Math.abs((weeks ?? 0) - 106.4)).toBeLessThan(0.1);
  });
  it("Genesis activation breaks even in about 6.3 weeks", () => {
    const weekly = weeklyRfFor(2_000_000, TOTAL_WEIGHT_RF, RF_STREAM_RF);
    const weeks = breakEvenWeeks(activateCostRf("Genesis", 0), weekly);
    expect(Math.abs((weeks ?? 0) - 6.3)).toBeLessThan(0.1);
  });
  it("no gain means no break-even", () => {
    expect(breakEvenWeeks(10, 0)).toBeNull();
    expect(breakEvenWeeks(0, 5)).toBe(0);
    expect(weeklyRfFor(5, 0, 100)).toBe(0);
  });
});

describe("wei conversions", () => {
  it("round-trips protocol amounts exactly", () => {
    expect(weiToRf(198_750_000_000_000_000_000n)).toBe(198.75);
    expect(rfToWei(0.5)).toBe(5n * 10n ** 17n);
    expect(rfToWei(100_000)).toBe(100_000n * 10n ** 18n);
    expect(() => rfToWei(-1)).toThrow(RangeError);
  });
});
