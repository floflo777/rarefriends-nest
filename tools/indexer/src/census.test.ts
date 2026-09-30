import { describe, expect, it } from "vitest";
import { GENESIS_RESERVE, summarizeGenesis, type GenesisToken } from "./genesis.js";
import { applyHardwiredEvents, emptyHardwiredState, HARDWIRED_FIRST_BLOCK, isCurrentHardwiredState, toSnapshotHardwired, type HardwiredEvent } from "./hardwired.js";

const H1 = "0x2287e0B2F6757F1502F17dFa83b0388Be9ce52Ff" as const;
const H2 = "0xA850B2499c064900EfF341745807e1cB0d71a52b" as const;

function ev(holder: `0x${string}`, generation: number, block: number, tokenId = block): HardwiredEvent {
  return { holder, generation, tokenId: BigInt(tokenId), blockNumber: BigInt(block) };
}

describe("hardwired state", () => {
  it("starts empty and covers nothing", () => {
    const s = emptyHardwiredState(HARDWIRED_FIRST_BLOCK);
    expect(s.total).toBe(0);
    expect(s.toBlock).toBe(Number(HARDWIRED_FIRST_BLOCK) - 1);
    expect(toSnapshotHardwired(s)).toEqual({ total: 0, byGeneration: {}, wallets: 0, firstBlock: 0, maxTokenId: 0 });
    expect(isCurrentHardwiredState(s)).toBe(true);
    expect(isCurrentHardwiredState({ ...s, maxTokenId: undefined })).toBe(false);
  });
  it("folds events, counts distinct wallets case-insensitively and merges incrementally", () => {
    let s = emptyHardwiredState(HARDWIRED_FIRST_BLOCK);
    s = applyHardwiredEvents(s, [ev(H1, 6, 64_590_957, 1025), ev(H1.toLowerCase() as `0x${string}`, 6, 64_590_960, 1026), ev(H2, 5, 64_591_000, 7)], 65_000_000n);
    expect(s.total).toBe(3);
    expect(s.byGeneration).toEqual({ "6": 2, "5": 1 });
    expect(s.wallets).toHaveLength(2);
    expect(s.firstBlock).toBe(64_590_957);
    expect(s.toBlock).toBe(65_000_000);
    expect(s.maxTokenId).toBe(1026);

    const s2 = applyHardwiredEvents(s, [ev(H2, 1, 66_000_000, 70_000)], 66_500_000n);
    expect(s2.total).toBe(4);
    expect(s2.maxTokenId).toBe(70_000);
    expect(s2.wallets).toHaveLength(2);
    expect(s2.byGeneration["1"]).toBe(1);
    expect(s.total).toBe(3); // immutable
    const snap = toSnapshotHardwired(s2);
    expect(Object.keys(snap.byGeneration)).toEqual(["1", "5", "6"]);
    expect(snap.wallets).toBe(2);
    expect(snap.firstBlock).toBe(64_590_957);
    expect(snap.maxTokenId).toBe(70_000);
  });
});

describe("summarizeGenesis", () => {
  it("counts activated, inactive, reserve-held and inactive owners", () => {
    const tokens: GenesisToken[] = [
      { id: 1, tier: 0, weight: 2_000_000n * 10n ** 18n, owner: null },
      { id: 2, tier: 1, weight: 1n, owner: null },
      { id: 3, tier: 0, weight: 0n, owner: GENESIS_RESERVE },
      { id: 4, tier: 0, weight: 0n, owner: GENESIS_RESERVE.toLowerCase() as `0x${string}` },
      { id: 5, tier: 0, weight: 0n, owner: H1 },
      { id: 6, tier: 0, weight: 0n, owner: null },
    ];
    const s = summarizeGenesis(tokens);
    expect(s.activated).toBe(2);
    expect(s.inactive).toBe(4);
    expect(s.reserveHeld).toBe(2);
    expect(s.unreadable).toBe(1);
    expect(Object.values(s.inactiveByOwner).reduce((a, b) => a + b, 0)).toBe(3);
    expect(s.inactiveByOwner[H1]).toBe(1);
  });
});
