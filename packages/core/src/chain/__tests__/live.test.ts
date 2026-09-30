/**
 * Live smoke test against the public RPC. Skipped unless NEST_LIVE=1.
 * Reference facts from 2026-09-30: Friend 343695 Gen 4 tier 1 (weight 198.75),
 * Friend 1969 Gen 1 tier 2 (416,250), Genesis 597 active (2,000,000).
 */
import { describe, expect, it } from "vitest";
import { isAddress } from "viem";
import { createNestClient, sleep } from "../client.js";
import { TemporaryFriendError, discoverOwnedFriends, readFriend, readHousehold, readProtocolState } from "../reads.js";
import { readEligibility } from "../../gate.js";
import { planHousehold } from "../../steward/planner.js";
import { dryRun } from "../../steward/dryRun.js";
import { weiToRf } from "../../protocol/math.js";
import { ADDRESSES } from "../../protocol/constants.js";

const live = process.env["NEST_LIVE"] === "1";
const RF = 10n ** 18n;

describe.skipIf(!live)("live smoke (NEST_LIVE=1)", () => {
  const client = createNestClient();

  it("reads the protocol state", async () => {
    const state = await readProtocolState(client);
    expect(state.blockNumber).toBeGreaterThan(76_000_000n);
    expect(state.timestamp).toBeGreaterThan(1_790_000_000);
    expect(weiToRf(state.totalWeight)).toBeGreaterThan(1_000_000_000);
    expect(weiToRf(state.rfStream.amount)).toBeGreaterThan(1_000_000);
    expect(state.rfStream.periodFinish).toBeGreaterThan(state.rfStream.lastUpdate);
    expect(state.wethStream.amount).toBeGreaterThan(0n);
    expect(state.rfTotalSupply).toBeLessThan(1_024_000_000n * RF);
    console.log("state", { block: state.blockNumber, totalWeight: weiToRf(state.totalWeight), rfStream: weiToRf(state.rfStream.amount) });
  });

  it("reads Friend 343695 (Gen 4 tier 1) and 1969 (Gen 1 tier 2)", async () => {
    await sleep(300);
    const f = await readFriend(client, "Generations", 343695n);
    expect(f.generation).toBe(4);
    expect(f.position.tier).toBe(1);
    expect(f.position.active).toBe(true);
    expect(f.position.weight).toBe(198_750_000_000_000_000_000n);
    expect(isAddress(f.owner)).toBe(true);
    expect(isAddress(f.wallet)).toBe(true);
    expect(f.family).toBe(4);
    expect(f.familyName).toBe("Asymmetry");
    expect(f.seed).toBe(343695);
    expect(f.savings.rf).toBeGreaterThanOrEqual(0n);
    console.log("343695", { owner: f.owner, wallet: f.wallet, earnedRf: weiToRf(f.rewards.earnedRf), savingsRf: weiToRf(f.savings.rf) });

    await sleep(300);
    const e = await readFriend(client, "Generations", 1969n);
    expect(e.generation).toBe(1);
    expect(e.position.tier).toBe(2);
    expect(e.position.weight).toBe(416_250n * RF);
    expect(e.familyName).toBeDefined();
  });

  it("reads Genesis 597 (active, weight 2,000,000)", async () => {
    await sleep(300);
    const g = await readFriend(client, "Genesis", 597n);
    expect(g.generation).toBe(0);
    expect(g.family).toBeUndefined();
    expect(g.position.active).toBe(true);
    expect(g.position.weight).toBe(2_000_000n * RF);
  });

  it("reports a temporary Friend clearly", async () => {
    await sleep(300);
    // The most recent temporary Friend id is unknown in advance; probe a high id that does not exist yet.
    const probe = readFriend(client, "Generations", 10_000_000n);
    await expect(probe).rejects.toBeInstanceOf(Error);
    await probe.catch((err: unknown) => {
      if (err instanceof TemporaryFriendError) expect(err.tokenId).toBe(10_000_000n);
      else expect(String(err)).toMatch(/ownerOf reverted/);
    });
  });

  it("gates on ownership at a fresh block", async () => {
    await sleep(300);
    const f = await readFriend(client, "Generations", 343695n);
    const ok = await readEligibility(client, f.owner, "Generations", 343695n);
    expect(ok.eligible).toBe(true);
    expect(ok.generation).toBe(4);
    const no = await readEligibility(client, ADDRESSES.zero, "Generations", 343695n);
    expect(no.eligible).toBe(false);
    expect(no.reason).toMatch(/owned by/);
  });

  it("discovers the household of Friend 343695's owner via Transfer logs and plans it", async () => {
    await sleep(300);
    const f = await readFriend(client, "Generations", 343695n);
    const windows: number[] = [];
    const found = await discoverOwnedFriends(client, f.owner, { onWindow: (w) => windows.push(w.logs) });
    console.log("discover", { generations: found.generations.length, genesis: found.genesis.length, windows: windows.length, toBlock: found.toBlock });
    expect(found.generations).toContain(343695n);
    expect(windows.length).toBeGreaterThan(0);

    await sleep(300);
    const household = await readHousehold(client, f.owner, {
      friends: [
        ...found.generations.map((tokenId) => ({ collection: "Generations" as const, tokenId })),
        ...found.genesis.map((tokenId) => ({ collection: "Genesis" as const, tokenId })),
      ],
    });
    expect(household.friends.length).toBe(found.generations.length + found.genesis.length);
    expect(household.friends.every((x) => x.owner.toLowerCase() === f.owner.toLowerCase())).toBe(true);

    const state = await readProtocolState(client);
    const plan = planHousehold(household, state);
    console.log("plan", plan.slice(0, 6).map((a) => ({ kind: a.kind, label: a.label, costRf: a.costRf, weeks: a.breakEvenWeeks, txs: a.txs.length })));
    expect(plan.length).toBeGreaterThan(0);
    const train = plan.find((a) => a.kind === "train" && a.friend?.tokenId === 343695n);
    expect(train?.costRf).toBe(75);

    // Dry-run: the upgrade calldata from the real owner. Either it passes (allowance and balance
    // in place) or it reverts with a decoded protocol error; it is never sent.
    await sleep(300);
    const upgradeTx = train?.txs.at(-1);
    expect(upgradeTx).toBeDefined();
    if (upgradeTx !== undefined) {
      const result = await dryRun(client, f.owner, upgradeTx);
      console.log("dryRun upgrade(343695)", result);
      if (!result.ok) expect(result.revertReason).toBeDefined();
      expect(result.ok || result.revertSelector !== undefined).toBe(true);
    }
    const claim = plan.find((a) => a.kind === "claim" && a.friend?.tokenId === 343695n);
    if (claim !== undefined) {
      await sleep(300);
      const result = await dryRun(client, f.owner, claim.txs[0]!);
      console.log("dryRun claim(343695)", result);
      expect(result.ok).toBe(true);
      expect(result.gas ?? 0n).toBeGreaterThan(21_000n);
    }
  }, 600_000);
});
