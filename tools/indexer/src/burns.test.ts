import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import { burnKey, classifySelector, mergeBurns, type IndexedBurn } from "./burns.js";

const A = "0x2287e0B2F6757F1502F17dFa83b0388Be9ce52Ff" as const;

function rec(n: number, logIndex = 0, extra: Partial<IndexedBurn> = {}): IndexedBurn {
  return {
    txHash: `0x${n.toString(16).padStart(64, "0")}` as Hex,
    blockNumber: BigInt(n),
    logIndex,
    timestamp: 1_700_000_000 + n,
    from: A,
    action: "hardwire",
    burnedRf: 10n ** 18n,
    ...extra,
  };
}

describe("classifySelector", () => {
  it("maps known selectors, case-insensitively, ignoring trailing calldata", () => {
    expect(classifySelector("0x9f68c98a0000000000000000000000000000000000000000000000000000000000000006")).toBe("hardwire");
    expect(classifySelector("0x5455429e")).toBe("promote");
    expect(classifySelector("0xE0622B27")).toBe("upgrade");
    expect(classifySelector("0xca11be69ff")).toBe("activate");
    expect(classifySelector("0x996cba68")).toBe("claim");
    expect(classifySelector("0x3b76f8d8")).toBe("claimBatch");
  });
  it("returns unknown for anything else", () => {
    expect(classifySelector("0xdeadbeef00")).toBe("unknown");
    expect(classifySelector("0x")).toBe("unknown");
    expect(classifySelector("")).toBe("unknown");
    expect(classifySelector(undefined)).toBe("unknown");
    expect(classifySelector(null)).toBe("unknown");
  });
});

describe("mergeBurns", () => {
  it("drops cached records in the re-indexed range and appends fresh ones, sorted", () => {
    const cached = [rec(1), rec(2), rec(5), rec(6)];
    const fresh = [rec(7), rec(5, 0, { burnedRf: 2n * 10n ** 18n }), rec(6)];
    const merged = mergeBurns(cached, fresh, 5n);
    expect(merged.map((r) => Number(r.blockNumber))).toEqual([1, 2, 5, 6, 7]);
    expect(merged[2]?.burnedRf).toBe(2n * 10n ** 18n); // fresh wins for block 5
  });
  it("de-duplicates on (txHash, logIndex) and keeps distinct logs of one tx", () => {
    const tx = rec(3, 0);
    const sameTxOtherLog = rec(3, 1);
    const merged = mergeBurns([tx], [tx, sameTxOtherLog], 100n);
    expect(merged).toHaveLength(2);
    expect(merged.map((r) => r.logIndex)).toEqual([0, 1]);
    expect(burnKey(tx)).not.toBe(burnKey(sameTxOtherLog));
  });
  it("is a plain union when reindexFrom is beyond everything", () => {
    expect(mergeBurns([rec(1)], [rec(2)], 10n)).toHaveLength(2);
    expect(mergeBurns([], [], 0n)).toEqual([]);
  });
  it("burnKey is case-insensitive on the hash", () => {
    expect(burnKey({ txHash: "0xABC", logIndex: 1 })).toBe(burnKey({ txHash: "0xabc", logIndex: 1 }));
  });
});
