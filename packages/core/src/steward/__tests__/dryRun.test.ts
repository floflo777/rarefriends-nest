import { describe, expect, it } from "vitest";
import { encodeErrorResult, getAddress } from "viem";
import { KNOWN_REVERTS, REVERT_ABI, decodeRevertData, extractRevertData } from "../dryRun.js";

describe("revert decoding", () => {
  it("maps 0xfb8f41b2 to ERC20InsufficientAllowance", () => {
    expect(KNOWN_REVERTS.get("0xfb8f41b2")).toBe("ERC20InsufficientAllowance");
    const data = encodeErrorResult({
      abi: REVERT_ABI,
      errorName: "ERC20InsufficientAllowance",
      args: ["0xd4a35e11318e3679168d409184b788bcf9f283ac", 0n, 500_000_000_000_000_000n],
    });
    expect(data.startsWith("0xfb8f41b2")).toBe(true);
    const decoded = decodeRevertData(data);
    expect(decoded.selector).toBe("0xfb8f41b2");
    expect(decoded.reason).toBe(`ERC20InsufficientAllowance(${getAddress("0xd4a35e11318e3679168d409184b788bcf9f283ac")}, 0, 500000000000000000)`);
  });

  it("keeps unknown selectors as hex", () => {
    expect(decodeRevertData("0xdeadbeef00")).toEqual({ selector: "0xdeadbeef", reason: "unknown revert 0xdeadbeef" });
  });

  it("finds revert data down a cause chain", () => {
    const inner = Object.assign(new Error("execution reverted"), { data: "0xfb8f41b2" + "00".repeat(96) });
    const outer = new Error("call failed", { cause: new Error("wrapped", { cause: inner }) });
    expect(extractRevertData(outer)?.startsWith("0xfb8f41b2")).toBe(true);
    expect(extractRevertData(new Error("plain"))).toBeUndefined();
  });
});
