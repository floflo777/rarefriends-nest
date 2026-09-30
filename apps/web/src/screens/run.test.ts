import { describe, expect, it, vi } from "vitest";
import { encodeErrorResult } from "viem";
import { ADDRESSES, REVERT_ABI, planHousehold, type NestClient } from "@nest/core";
import { DEMO_OWNER, createMockSource } from "../data/mock.js";
import { demoLine, demoSender, demoVerdict, runDemo, type DemoPhase } from "./run.js";

/** A frozen clock: no demo-time accrual between the Feed and the assertions. */
const FROZEN = () => Date.UTC(2026, 9, 1, 12);

async function feedOf(mock = createMockSource({ now: FROZEN })) {
  const [household, state] = await Promise.all([mock.household(DEMO_OWNER), mock.protocolState()]);
  const plan = planHousehold(household, state);
  return { mock, feed: plan.find((a) => a.kind === "claim" && a.friend?.tokenId === 1969n)!, hatch: plan.find((a) => a.kind === "hatch")! };
}

const okClient = () =>
  ({
    simulateCalls: vi.fn(async ({ calls }: { calls: unknown[] }) => ({ results: calls.map(() => ({ status: "success", gasUsed: 60_000n })) })),
  }) as unknown as NestClient;

/** eth_simulateV1 and eth_call both fail with a transport error: the RPC is unreachable. */
const deadClient = () =>
  ({
    simulateCalls: vi.fn().mockRejectedValue(new Error("HTTP request failed.")),
    call: vi.fn().mockRejectedValue(new Error("HTTP request failed.")),
    estimateGas: vi.fn(),
  }) as unknown as NestClient;

/** eth_simulateV1 answers with a decoded OpenZeppelin revert on the first call. */
const revertingClient = () => {
  const data = encodeErrorResult({ abi: REVERT_ABI, errorName: "ERC20InsufficientBalance", args: [DEMO_OWNER, 0n, 112_500n * 10n ** 18n] });
  return {
    simulateCalls: vi.fn(async ({ calls }: { calls: unknown[] }) => ({
      results: calls.map((_, i) => (i === 0 ? { status: "failure", data, error: new Error("execution reverted") } : { status: "success", gasUsed: 1n })),
    })),
  } as unknown as NestClient;
};

describe("demo run: real dry-run, simulated mutation", () => {
  it("dry-runs from the real owner of the targeted Friend, household actions from the demo owner", async () => {
    const { feed, hatch } = await feedOf();
    expect(demoSender(feed, DEMO_OWNER).toLowerCase()).toBe("0x30df16cd7d612c5b25beb0331486b127a42ac371");
    expect(demoSender(hatch, DEMO_OWNER)).toBe(DEMO_OWNER);
  });

  it("DRY-RUN OK: reports gas, says NOT SENT, applies the mutation", async () => {
    const { mock, feed } = await feedOf();
    const client = okClient();
    const phases: DemoPhase[] = [];
    const r = await runDemo(feed, { client, owner: DEMO_OWNER, simulate: (a) => mock.simulate(a), onPhase: (p) => phases.push(p) });
    expect(r.applied).toBe(true);
    expect(r.line).toMatch(/^DRY-RUN OK · GAS 120,000 · NOT SENT \(DEMO\) · Fed #1969: [\d,.]+ RF claimed/);
    expect(phases.map((p) => p.phase)).toEqual(["simulating", "done"]);
    expect(client.simulateCalls).toHaveBeenCalledTimes(1);
    const call = (client.simulateCalls as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { account: string; calls: { to: string }[] };
    expect(call.account.toLowerCase()).toBe("0x30df16cd7d612c5b25beb0331486b127a42ac371");
    expect(call.calls.every((c) => c.to === ADDRESSES.activationManager)).toBe(true);
    expect((await mock.friend("Generations", 1969n)).rewards.earnedWeth).toBe(0n);
  });

  it("RPC UNAVAILABLE: falls back to the local simulation and says so", async () => {
    const { mock, feed } = await feedOf();
    const r = await runDemo(feed, { client: deadClient(), owner: DEMO_OWNER, simulate: (a) => mock.simulate(a) });
    expect(r.verdict.kind).toBe("unavailable");
    expect(r.applied).toBe(true);
    expect(r.line).toMatch(/^RPC UNAVAILABLE · LOCAL SIM · Fed #1969/);
    expect((await mock.friend("Generations", 1969n)).rewards.earnedWeth).toBe(0n);
  });

  it("WOULD REVERT: shows the decoded reason and applies nothing", async () => {
    const { mock, feed } = await feedOf();
    const before = await mock.friend("Generations", 1969n);
    const simulate = vi.fn((a: Parameters<typeof mock.simulate>[0]) => mock.simulate(a));
    const r = await runDemo(feed, { client: revertingClient(), owner: DEMO_OWNER, simulate });
    expect(r.verdict).toEqual({ kind: "revert", reason: expect.stringMatching(/^ERC20InsufficientBalance\(/) });
    expect(r.applied).toBe(false);
    expect(r.line).toBe("WOULD REVERT · ERC20InsufficientBalance · NOT SENT (DEMO)");
    expect(simulate).not.toHaveBeenCalled();
    expect((await mock.friend("Generations", 1969n)).savings.rf).toBe(before.savings.rf);
  });

  it("classifies results: decoded selector or revert message = revert, other failures = unavailable", () => {
    expect(demoVerdict([{ ok: true, gas: 1n }, { ok: true, gas: 2n }])).toEqual({ kind: "ok", gas: 3n });
    expect(demoVerdict([{ ok: false, revertSelector: "0xfb8f41b2", revertReason: "ERC20InsufficientAllowance(0x, 0, 1)" }]).kind).toBe("revert");
    expect(demoVerdict([{ ok: false, revertReason: "execution reverted" }]).kind).toBe("revert");
    expect(demoVerdict([{ ok: false, revertReason: "HTTP request failed." }]).kind).toBe("unavailable");
    expect(demoLine({ kind: "revert", reason: "NotTokenOwner()" }, null)).toBe("WOULD REVERT · NotTokenOwner · NOT SENT (DEMO)");
    expect(demoLine({ kind: "unavailable", reason: "x" }, "Fed #1")).toBe("RPC UNAVAILABLE · LOCAL SIM · Fed #1");
  });
});
