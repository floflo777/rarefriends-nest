import { describe, expect, it } from "vitest";
import { encodeFunctionData } from "viem";
import { ADDRESSES, ERC20_ABI, FAMILY_NAMES, FRAME_COUNT, describe as describeFriend, planHousehold, weeklyRfFor, weiToRf, type Snapshot } from "@nest/core";
import { friendKey } from "./source.js";
import { DEMO_FIXTURE, DEMO_OWNER, DEMO_TIME_SCALE, createMockSource, loadFixture } from "./mock.js";

const WEEK_S = 7 * 86_400;

function clock(startMs = Date.UTC(2026, 9, 1, 12)) {
  let t = startMs;
  return { now: () => t, advance: (s: number) => (t += s * 1000) };
}

describe("baked demo fixture", () => {
  it("is a real household: owner 0x3d35…, its two Friends and egg, plus #1969 and Genesis #597", () => {
    const f = loadFixture();
    expect(f.owner.toLowerCase()).toBe("0x3d35a856cb96f9770c986841f4fdb7e198a272cb");
    expect(f.blockNumber).toBeGreaterThan(76_000_000n);
    expect(f.bakedAt).toBeGreaterThan(Date.UTC(2026, 8, 30) / 1000);
    const ids = f.friends.map((x) => `${x.collection}:${x.tokenId}`);
    expect(ids).toEqual(expect.arrayContaining(["Generations:1969", "Generations:315174", "Generations:343695", "Genesis:597"]));
    expect(f.eggTokenId).not.toBeNull();
    expect(f.friends.filter((x) => x.owner.toLowerCase() === f.owner.toLowerCase()).map((x) => x.tokenId)).toEqual([315174n, 343695n]);
    expect(f.friends.find((x) => x.tokenId === 1969n)?.owner.toLowerCase()).toBe("0x30df16cd7d612c5b25beb0331486b127a42ac371");
  });

  it("produces valid core types: bigint amounts, registry families, real names and 64 frames per Friend", () => {
    const f = loadFixture();
    for (const friend of f.friends) {
      expect(typeof friend.position.weight).toBe("bigint");
      expect(typeof friend.rewards.earnedRf).toBe("bigint");
      expect(typeof friend.savings.eth).toBe("bigint");
      const sprite = f.sprites.get(friendKey(friend.collection, friend.tokenId))!;
      expect(sprite.frames).toHaveLength(FRAME_COUNT);
      expect(sprite.idle).toHaveLength(FRAME_COUNT / 2);
      const personality = describeFriend(friend);
      expect(personality.name).toMatch(/^[A-Z][a-z]+$/);
      if (friend.collection === "Generations") {
        expect(friend.family).toBeGreaterThanOrEqual(0);
        expect(FAMILY_NAMES[friend.family!]).toBe(friend.familyName);
        expect(personality.family).toBe(friend.familyName);
        expect(friend.seed).toBe(Number(friend.tokenId));
      } else {
        expect(friend.familyName).toBe("Genesis");
        expect(personality.family).toBe("Genesis");
      }
    }
    // #343695 is the QA cross-check: the real registry says Asymmetry, not the old placeholder Hoverer.
    const f343695 = f.friends.find((x) => x.tokenId === 343695n)!;
    expect(f343695.familyName).toBe("Asymmetry");
    expect(f.sprites.get("gen:343695")!.frames[0]!.bits).not.toBe(f.sprites.get("gen:1969")!.frames[0]!.bits);
  });

  it("rejects a fixture with a broken amount or a missing sprite", () => {
    const broken = structuredClone(DEMO_FIXTURE);
    broken.friends[0]!.position.weight = "12.5";
    expect(() => loadFixture(broken)).toThrow(/weight/);
    const missing = structuredClone(DEMO_FIXTURE);
    missing.friends[0]!.sprite = "frames:9:9";
    expect(() => loadFixture(missing)).toThrow(/sprite/);
  });

  it("carries a copy of the indexer census, never invented figures", () => {
    const f = loadFixture();
    expect(f.census).not.toBeNull();
    expect(f.census!.genesis.inactive).toBe(529);
    expect(f.census!.hardwired.total).toBeGreaterThan(62_000);
    expect(DEMO_FIXTURE.census!.source).toMatch(/snapshot\.json/);
  });
});

describe("mock accrual (demo time x1000)", () => {
  it("grows unclaimed rewards at the Friend's real weekly rate, accelerated, and restarts after a Feed", async () => {
    const c = clock();
    const mock = createMockSource({ now: c.now });
    const state = await mock.protocolState();
    const before = await mock.friend("Generations", 1969n);
    const weekly = weeklyRfFor(weiToRf(before.position.weight), weiToRf(state.totalWeight), weiToRf(state.rfStream.amount));
    expect(weekly).toBeGreaterThan(3000); // ~3,332 RF a week for 416,250 weight

    c.advance(600); // ten real minutes = ~one demo week
    const after = await mock.friend("Generations", 1969n);
    const gained = weiToRf(after.rewards.earnedRf - before.rewards.earnedRf);
    expect(gained).toBeCloseTo((weekly * 600 * DEMO_TIME_SCALE) / WEEK_S, 0);
    expect(after.rewards.earnedWeth).toBeGreaterThan(before.rewards.earnedWeth);
    expect(mock.timeScale).toBe(1000);

    const household = await mock.household(DEMO_OWNER);
    const feed = planHousehold(household, state).find((a) => a.kind === "claim" && a.friend?.tokenId === 1969n)!;
    expect(mock.simulate(feed)).toMatch(/^Fed #1969/);
    const fed = await mock.friend("Generations", 1969n);
    expect(fed.rewards.earnedRf).toBe(0n);
    expect(weiToRf(fed.savings.rf)).toBeCloseTo(weiToRf(after.rewards.earnedRf), 3);
    c.advance(60);
    const hungryAgain = await mock.friend("Generations", 1969n);
    expect(weiToRf(hungryAgain.rewards.earnedRf)).toBeCloseTo((weekly * 60 * DEMO_TIME_SCALE) / WEEK_S, 0);
  });

  it("does not accrue for an inactive Friend and keeps the stream period anchored on the session", async () => {
    const c = clock();
    const mock = createMockSource({ now: c.now, timeScale: 1 });
    const state = await mock.protocolState();
    expect(state.rfStream.periodFinish).toBe(Math.floor(c.now() / 1000) + WEEK_S);
    expect(state.rfStream.amount).toBe(mock.fixture.protocol.rfStream.amount);
    c.advance(WEEK_S);
    const genesis = await mock.friend("Genesis", 597n);
    expect(weiToRf(genesis.rewards.earnedRf)).toBeGreaterThan(weiToRf(mock.fixture.friends.find((f) => f.tokenId === 597n)!.rewards.earnedRf));
  });
});

describe("mock snapshot and simulation", () => {
  const fake: Snapshot = {
    blockNumber: 1,
    timestamp: 1,
    totals: { burnedRf: 10, burnEvents: 1, byAction: {} },
    daily: [],
    leaderboard: [{ owner: "0x0000000000000000000000000000000000000001", burnedRf: 10, actions: 1, lastActionAt: 1 }],
    hardwired: { total: 1, byGeneration: {}, wallets: 1, firstBlock: 1 },
    genesis: { activated: 1, inactive: 2, reserveHeld: 3 },
  };

  it("prefers the real snapshot, falls back to the fixture census, and overlays the demo's own burns", async () => {
    const real = createMockSource({ snapshot: async () => fake });
    expect((await real.snapshot()).genesis.inactive).toBe(2);
    const offline = createMockSource({ snapshot: async () => Promise.reject(new Error("offline")) });
    const census = await offline.snapshot();
    expect(census.genesis.inactive).toBe(529);
    expect(census.leaderboard.some((r) => r.owner.toLowerCase() === DEMO_OWNER.toLowerCase())).toBe(false); // the real owner is unranked

    const [household, state] = await Promise.all([offline.household(DEMO_OWNER), offline.protocolState()]);
    const train = planHousehold(household, state).find((a) => a.kind === "train" && a.friend?.tokenId === 343695n)!;
    expect(offline.simulate(train)).toBe("Trained #343695 to tier 2");
    const after = await offline.snapshot();
    expect(after.totals.burnedRf - census.totals.burnedRf).toBeCloseTo(train.burnRf, 6);
    const mine = after.leaderboard.find((r) => r.owner.toLowerCase() === DEMO_OWNER.toLowerCase())!;
    expect(mine.burnedRf).toBeCloseTo(train.burnRf, 6);
    expect(mine.actions).toBe(1);
    expect((await offline.protocolState()).totalWeight).toBe(state.totalWeight + (await offline.friend("Generations", 343695n)).position.weight - household.friends.find((f) => f.tokenId === 343695n)!.position.weight);
  });

  it("hatches the real egg at the generation the real balance affords, then withdraws savings through the ERC-6551 wallet", async () => {
    const mock = createMockSource();
    const household = await mock.household(DEMO_OWNER);
    const state = await mock.protocolState();
    const egg = mock.fixture.eggTokenId!;
    const plan = planHousehold(household, state);
    const hatch = plan.find((a) => a.kind === "hatch")!;
    expect(hatch.hatchGeneration).toBe(4); // 110.63 RF in the wallet -> Gen-4 for 100 RF
    expect(mock.simulate(hatch)).toMatch(new RegExp(`^Hatched #${egg} as a Gen-4 pup`));
    const h2 = await mock.household(DEMO_OWNER);
    const pup = h2.friends.find((f) => f.tokenId === egg)!;
    expect(pup.generation).toBe(4);
    expect(pup.familyName).toBeUndefined(); // unknown until the registry knows the pup
    expect((await mock.sprite(pup)).frames).toHaveLength(FRAME_COUNT);
    expect(h2.rfBalance).toBe(household.rfBalance - 100n * 10n ** 18n);

    const feed = plan.find((a) => a.kind === "claim" && a.friend?.tokenId === 1969n)!;
    mock.simulate(feed);
    const withdraw = planHousehold(await mock.household(DEMO_OWNER), state).find((a) => a.kind === "withdraw" && a.friend?.tokenId === 1969n)!;
    expect(withdraw.txs[0]!.to).toBe((await mock.friend("Generations", 1969n)).wallet);
    expect(mock.simulate(withdraw)).toMatch(/^Withdrew [\d,.]+ RF from #1969's wallet$/);
    expect((await mock.friend("Generations", 1969n)).savings.rf).toBe(0n);
  });

  it("rejects calldata it cannot honour and resets cleanly", async () => {
    const mock = createMockSource();
    const bad = { kind: "save" as const, label: "x", costRf: 0, burnRf: 0, toRewardsRf: 0, deltaWeight: 0, weeklyRfGain: 0, breakEvenWeeks: null, rationale: "", txs: [{ to: ADDRESSES.rf, data: encodeFunctionData({ abi: ERC20_ABI, functionName: "totalSupply" }), value: 0n, description: "" }] };
    expect(() => mock.simulate(bad)).toThrow(/unsupported RF call/);
    const h = await mock.household(DEMO_OWNER);
    const hatch = planHousehold(h, await mock.protocolState()).find((a) => a.kind === "hatch")!;
    mock.simulate(hatch);
    mock.reset();
    const again = await mock.household(DEMO_OWNER);
    expect(again.eggTokenId).toBe(mock.fixture.eggTokenId);
    expect(again.friends).toHaveLength(mock.fixture.friends.length);
    expect(again.rfBalance).toBe(mock.fixture.rfBalance);
  });
});
