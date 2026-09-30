import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { encodeErrorResult } from "viem";
import type { Hex } from "viem";
import { ADDRESSES, REVERT_ABI, dryRunAll, type Eligibility, type NestClient } from "@nest/core";
import { createMockSource, DEMO_OWNER } from "../data/mock.js";
import type { ChainActions } from "../wallet/actions.js";
import { lcdText } from "./demo.test.jsx";
import { Device } from "./Device.jsx";

const OWNER_OK: Eligibility = { eligible: true, reason: "owner matches", blockNumber: 76_460_001n };

/** A client whose eth_simulateV1 is unsupported and whose eth_call reverts with an OpenZeppelin error. */
function revertingClient(): NestClient {
  const data = encodeErrorResult({ abi: REVERT_ABI, errorName: "ERC20InsufficientAllowance", args: [ADDRESSES.activationManager, 0n, 112_500n * 10n ** 18n] });
  const revert = Object.assign(new Error("execution reverted"), { data });
  return {
    simulateCalls: vi.fn().mockRejectedValue(new Error("the method eth_simulateV1 does not exist")),
    call: vi.fn().mockRejectedValue(revert),
    estimateGas: vi.fn(),
  } as unknown as NestClient;
}

function chainWith(client: NestClient, eligibility: Eligibility = OWNER_OK) {
  let sent = 0;
  const send = vi.fn(async (_tx: unknown, onSent: (h: Hex) => void): Promise<Hex> => {
    const hash: Hex = `0x${"ab".repeat(31)}${(++sent).toString(16).padStart(2, "0")}`;
    onSent(hash);
    return hash;
  });
  const chain: ChainActions = {
    account: DEMO_OWNER,
    dryRun: (txs) => dryRunAll(client, DEMO_OWNER, txs),
    eligibility: vi.fn(async () => eligibility),
    send,
    settled: vi.fn(),
  };
  return { chain, send };
}

async function openConfirm(chain: ChainActions) {
  const mock = createMockSource();
  render(<Device source={mock} mode="wallet" target={{ kind: "household", owner: DEMO_OWNER }} chain={chain} />);
  await waitFor(() => expect(lcdText()).toContain("G1 T2"));
  const ok = screen.getByRole("button", { name: "OK" });
  fireEvent.click(ok); // PET -> CARE
  await waitFor(() => expect(lcdText().some((l) => l.includes("FEED #1969"))).toBe(true));
  // Wait for the ownership gate before selecting.
  await waitFor(() => expect(lcdText()).toContain("@ OK"));
  fireEvent.click(ok); // Feed -> CONFIRM
  return { mock, ok };
}

describe("wallet mode: dry-run gating and signing", () => {
  it("shows the decoded revert reason and never offers to sign when the dry run fails", async () => {
    const client = revertingClient();
    const { chain, send } = chainWith(client);
    const { ok } = await openConfirm(chain);
    expect(lcdText()).toContain("[ YES ]");
    fireEvent.click(ok); // YES -> SIMULATING
    await waitFor(() => expect(lcdText()).toContain("WOULD REVERT"));
    expect(lcdText().join(" ")).toContain("ERC20 INSUFFICIENT ALLOWANCE");
    expect(lcdText().join(" ")).toContain("113K RF"); // the `needed` argument, compacted
    expect(lcdText().some((l) => l.includes("SIGN"))).toBe(false);
    expect(client.simulateCalls).toHaveBeenCalledTimes(1);
    expect(client.call).toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "ArrowRight" }); // ignored while rejected
    expect(lcdText()).toContain("WOULD REVERT");
    fireEvent.click(ok); // BACK
    await waitFor(() => expect(lcdText()).toContain("G1 T2"));
    expect(send).not.toHaveBeenCalled();
  });

  it("locks a Friend's actions when the ownership gate fails", async () => {
    const client = revertingClient();
    const { chain, send } = chainWith(client, { eligible: false, reason: "Generations #1969 is owned by 0xabc, not 0xdef", blockNumber: 1n });
    const mock = createMockSource();
    render(<Device source={mock} mode="wallet" target={{ kind: "household", owner: DEMO_OWNER }} chain={chain} />);
    await waitFor(() => expect(lcdText()).toContain("G1 T2"));
    const ok = screen.getByRole("button", { name: "OK" });
    fireEvent.click(ok);
    await waitFor(() => expect(lcdText()).toContain("@ LOCKED"));
    fireEvent.click(ok);
    expect(lcdText()).toContain("LOCKED:");
    expect(lcdText().join(" ")).toContain("IS OWNED BY 0XABC");
    expect(lcdText()).toContain("[ BACK ]");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.click(ok); // back, never an action
    expect(client.simulateCalls).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("dry run OK -> gas -> sign each tx in order -> DONE with an explorer link", async () => {
    const client = {
      simulateCalls: vi.fn(async ({ calls }: { calls: unknown[] }) => ({ results: calls.map(() => ({ status: "success", gasUsed: 60_000n })) })),
    } as unknown as NestClient;
    const { chain, send } = chainWith(client);
    const { ok } = await openConfirm(chain);
    fireEvent.click(ok); // YES
    await waitFor(() => expect(lcdText()).toContain("OK"));
    expect(lcdText()).toContain("GAS 120,000"); // two claims (RF + WETH)
    expect(lcdText()).toContain("@ SIGN");
    fireEvent.click(ok); // sign
    await waitFor(() => expect(lcdText()).toContain("DONE"));
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toMatchObject({ to: ADDRESSES.activationManager });
    const links = screen.getAllByRole("link", { name: /tx 0xabababab/ });
    expect(links.map((l) => l.getAttribute("href"))).toEqual([1, 2].map((i) => `https://robinhoodchain.blockscout.com/tx/0x${"ab".repeat(31)}0${i}`));
    fireEvent.click(ok); // OK -> refresh household
    expect(chain.settled).toHaveBeenCalled();
  });
});
