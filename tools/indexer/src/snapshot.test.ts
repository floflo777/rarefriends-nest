import { describe, expect, it } from "vitest";
import { getAddress, type Hex } from "viem";
import type { IndexedBurn } from "./burns.js";
import { buildDaily, buildLeaderboard, buildSnapshot, buildTotals, dayOf, weiToRf } from "./snapshot.js";

const RF = 10n ** 18n;
const A = "0x2287e0b2f6757f1502f17dfa83b0388be9ce52ff" as const; // lower-case on purpose
const A_CHECKSUM = getAddress(A);
const B = "0xA850B2499c064900EfF341745807e1cB0d71a52b" as const;
const C = "0x0000000000000000000000000000000000000003" as const;

let seq = 0;
function rec(from: `0x${string}`, rf: number, timestamp: number, action: IndexedBurn["action"] = "hardwire", txHash?: Hex): IndexedBurn {
  seq++;
  return {
    txHash: txHash ?? (`0x${seq.toString(16).padStart(64, "0")}` as Hex),
    blockNumber: BigInt(seq),
    logIndex: 0,
    timestamp,
    from,
    action,
    burnedRf: BigInt(Math.round(rf * 1e6)) * 10n ** 12n,
  };
}

const D1 = Date.UTC(2026, 8, 29, 23, 59, 59) / 1000; // 2026-09-29T23:59:59Z
const D2 = Date.UTC(2026, 8, 30, 0, 0, 0) / 1000; // 2026-09-30T00:00:00Z
const D3 = Date.UTC(2026, 9, 2, 12, 0, 0) / 1000; // 2026-10-02

describe("weiToRf / dayOf", () => {
  it("converts wei to RF with micro precision", () => {
    expect(weiToRf(0n)).toBe(0);
    expect(weiToRf(RF)).toBe(1);
    expect(weiToRf(4_500_000_000_000_000_000n)).toBe(4.5);
    expect(weiToRf(76_261_872n * RF)).toBe(76_261_872);
    expect(weiToRf(1_234_567n)).toBe(0); // below 1 micro-RF
  });
  it("buckets by UTC day", () => {
    expect(dayOf(D1)).toBe("2026-09-29");
    expect(dayOf(D2)).toBe("2026-09-30");
    expect(dayOf(0)).toBe("1970-01-01");
  });
});

describe("buildDaily", () => {
  it("sums per UTC day, ascending, skipping empty days", () => {
    const daily = buildDaily([rec(A, 1, D2), rec(B, 0.5, D1), rec(A, 4.5, D3), rec(C, 2, D2)]);
    expect(daily).toEqual([
      { day: "2026-09-29", burnedRf: 0.5, events: 1 },
      { day: "2026-09-30", burnedRf: 3, events: 2 },
      { day: "2026-10-02", burnedRf: 4.5, events: 1 },
    ]);
  });
  it("is empty for no records", () => {
    expect(buildDaily([])).toEqual([]);
  });
});

describe("buildLeaderboard", () => {
  it("aggregates per household with checksummed owner, distinct tx count and last action", () => {
    const tx = `0x${"ab".repeat(32)}` as Hex;
    const records = [
      rec(A, 1, D1),
      rec(A, 4.5, D3, "promote"),
      rec(B, 100, D2, "upgrade"),
      { ...rec(C, 1, D2, "hardwire", tx), logIndex: 0 },
      { ...rec(C, 1, D2, "hardwire", tx), logIndex: 1 }, // second burn log in the same tx
    ];
    const lb = buildLeaderboard(records);
    expect(lb.map((h) => h.owner)).toEqual([B, A_CHECKSUM, "0x0000000000000000000000000000000000000003"]);
    expect(lb[0]).toEqual({ owner: B, burnedRf: 100, actions: 1, lastActionAt: D2 });
    expect(lb[1]).toEqual({ owner: A_CHECKSUM, burnedRf: 5.5, actions: 2, lastActionAt: D3 });
    expect(lb[2]).toEqual({ owner: "0x0000000000000000000000000000000000000003", burnedRf: 2, actions: 1, lastActionAt: D2 });
  });
  it("merges case variants of the same address", () => {
    const lb = buildLeaderboard([rec(A, 1, D1), rec(A_CHECKSUM as `0x${string}`, 1, D2)]);
    expect(lb).toHaveLength(1);
    expect(lb[0]?.burnedRf).toBe(2);
  });
  it("breaks ties by actions then address and honours the limit", () => {
    const lb = buildLeaderboard([rec(B, 2, D1), rec(A, 1, D1), rec(A, 1, D2), rec(C, 2, D1)], 2);
    expect(lb.map((h) => h.owner)).toEqual([A_CHECKSUM, "0x0000000000000000000000000000000000000003"]);
  });
});

describe("buildTotals / buildSnapshot", () => {
  it("totals by action ordered by RF burned", () => {
    const totals = buildTotals([rec(A, 1, D1), rec(A, 1, D1), rec(B, 50, D1, "upgrade"), rec(C, 3, D1, "unknown")]);
    expect(totals.burnEvents).toBe(4);
    expect(totals.burnedRf).toBe(55);
    expect(Object.keys(totals.byAction)).toEqual(["upgrade", "unknown", "hardwire"]);
    expect(totals.byAction["hardwire"]).toEqual({ count: 2, burnedRf: 2 });
  });
  it("assembles a JSON-safe snapshot", () => {
    const snap = buildSnapshot({
      records: [rec(A, 1, D1)],
      hardwired: { total: 1, byGeneration: { "6": 1 }, wallets: 1, firstBlock: 64_590_957 },
      genesis: { activated: 10, inactive: 1014, reserveHeld: 1000 },
      blockNumber: 76_000_000,
      timestamp: D3,
    });
    expect(snap.blockNumber).toBe(76_000_000);
    expect(snap.leaderboard[0]?.owner).toBe(A_CHECKSUM);
    expect(() => JSON.stringify(snap)).not.toThrow(); // no bigint left
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
  });
});
