import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import { burnKey, classifyByReceipt, classifySelector, isViaNest, mergeBurns, selectorOf, type IndexedBurn } from "./burns.js";
import { ACTIVATION_MANAGER_TOPICS } from "./events.js";

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
    selector: "0x9f68c98a",
    viaNest: false,
    receiptChecked: false,
    ...extra,
  };
}

const AM = "0xd4a35e11318e3679168d409184b788bcf9f283ac" as const;
const OTHER = "0x0779369854d3EcdEA927206718FFD7730C67B71f" as const;

describe("selectorOf / isViaNest", () => {
  it("extracts a lower-cased selector or 0x", () => {
    expect(selectorOf("0x9F68C98A00")).toBe("0x9f68c98a");
    expect(selectorOf("0x9f68c9")).toBe("0x");
    expect(selectorOf(undefined)).toBe("0x");
  });
  it("detects the Nest tag at the end of the calldata, case-insensitively", () => {
    expect(isViaNest("0x9f68c98a00000000000000000000000000000000000000000000000000000000000000064e4553540001")).toBe(true);
    expect(isViaNest("0x9f68c98a00000000000000000000000000000000000000000000000000000000000000064E4553540001")).toBe(true);
    expect(isViaNest("0x9f68c98a0000000000000000000000000000000000000000000000000000000000000006")).toBe(false);
    expect(isViaNest("0x4e4553540001")).toBe(false); // tag alone, no selector
    expect(isViaNest(undefined)).toBe(false);
  });
});

describe("classifyByReceipt", () => {
  const log = (address: `0x${string}`, topic: `0x${string}`) => ({ address, topics: [topic] as `0x${string}`[] });
  it("hardwire when a Hardwired event is emitted by ActivationManager", () => {
    expect(classifyByReceipt([log(AM, ACTIVATION_MANAGER_TOPICS.Claimed), log(AM, ACTIVATION_MANAGER_TOPICS.Hardwired)])).toBe("hardwire");
    expect(classifyByReceipt([log(AM, ACTIVATION_MANAGER_TOPICS.Hardwired.toUpperCase().replace("0X", "0x") as `0x${string}`)])).toBe("hardwire");
  });
  it("promote on Promoted, hardwire wins over promote", () => {
    expect(classifyByReceipt([log(AM, ACTIVATION_MANAGER_TOPICS.Promoted)])).toBe("promote");
    expect(classifyByReceipt([log(AM, ACTIVATION_MANAGER_TOPICS.Promoted), log(AM, ACTIVATION_MANAGER_TOPICS.Hardwired)])).toBe("hardwire");
  });
  it("ignores events from other contracts and stays unknown otherwise", () => {
    expect(classifyByReceipt([log(OTHER, ACTIVATION_MANAGER_TOPICS.Hardwired)])).toBe("unknown");
    expect(classifyByReceipt([log(AM, ACTIVATION_MANAGER_TOPICS.Claimed), log(AM, ACTIVATION_MANAGER_TOPICS.Funded)])).toBe("unknown");
    expect(classifyByReceipt([])).toBe("unknown");
  });
});

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
  it("only drops cached records inside [reindexFrom, reindexTo] when an upper bound is given", () => {
    const cached = [rec(1), rec(5), rec(9)];
    const merged = mergeBurns(cached, [rec(6)], 4n, 7n);
    expect(merged.map((r) => Number(r.blockNumber))).toEqual([1, 6, 9]);
  });
  it("is a plain union when reindexFrom is beyond everything", () => {
    expect(mergeBurns([rec(1)], [rec(2)], 10n)).toHaveLength(2);
    expect(mergeBurns([], [], 0n)).toEqual([]);
  });
  it("burnKey is case-insensitive on the hash", () => {
    expect(burnKey({ txHash: "0xABC", logIndex: 1 })).toBe(burnKey({ txHash: "0xabc", logIndex: 1 }));
  });
});
