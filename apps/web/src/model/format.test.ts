import { describe, expect, it } from "vitest";
import { parseEther } from "viem";
import { compact, compactWei, grouped, percent } from "./format.js";
import { blockLabel } from "./snapshot.js";

describe("LCD number formats", () => {
  it("never prints scientific notation and floors tiny shares at <0.001%", () => {
    expect(percent(1.9e-7)).toBe("<0.001%");
    expect(percent(0)).toBe("0%");
    expect(percent(0.00038948)).toBe("0.0389%");
    expect(percent(0.00187137)).toBe("0.187%");
    expect(percent(0.5123)).toBe("51.2%");
    expect(percent(1)).toBe("100%");
    expect(percent(0.00001)).toBe("0.001%");
  });

  it("compacts RF with three significant digits", () => {
    expect(compact(36384.65)).toBe("36.4K");
    expect(compact(112500)).toBe("113K");
    expect(compact(416250)).toBe("416K");
    expect(compact(100000)).toBe("100K");
    expect(compact(8547984.3)).toBe("8.55M");
    expect(compact(76267677)).toBe("76.3M");
    expect(compact(1_068_730_245)).toBe("1.07B");
    expect(compact(3331.5)).toBe("3,332");
    expect(compact(999.4)).toBe("999.4");
    expect(compact(62.6, 1)).toBe("62.6");
    expect(compact(0.05)).toBe("0.05");
    expect(compact(0.0088)).toBe("0.0088");
    expect(compact(0.0141)).toBe("0.0141");
    expect(compact(0.00000001)).toBe("<0.000001");
    expect(compact(0)).toBe("0");
    expect(compact(-1500)).toBe("-1,500");
    expect(compactWei(parseEther("36384.65"))).toBe("36.4K");
    expect(compactWei(parseEther("0.0228"), 4)).toBe("0.0228");
  });

  it("groups whole numbers and falls back to compact when too long", () => {
    expect(grouped(36384.65)).toBe("36,385");
    expect(grouped(1_068_730_245)).toBe("1.07B");
    expect(grouped(1_068_730_245, 13)).toBe("1,068,730,245");
  });

  it("labels blocks with one decimal million", () => {
    expect(blockLabel(64_981_920)).toBe("65.0M");
    expect(blockLabel(76_481_919)).toBe("76.5M");
    expect(blockLabel(0)).toBe("0");
  });
});
