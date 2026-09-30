/**
 * Dry-runs a prepared transaction from the holder's address with eth_call then
 * eth_estimateGas. Nothing is ever signed or sent.
 */
import { BaseError, decodeErrorResult, parseAbi, toFunctionSelector } from "viem";
import type { Address, Hex } from "viem";
import type { DryRunResult, PreparedTx } from "../types.js";
import { errorChain, withRetry, type NestClient } from "../chain/client.js";

/** OpenZeppelin 5 custom errors the protocol contracts can surface; NotAuthorized is the ERC-6551 account's (execute by a non-owner). */
export const REVERT_ABI = parseAbi([
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InvalidReceiver(address receiver)",
  "error ERC20InvalidSender(address sender)",
  "error ERC721NonexistentToken(uint256 tokenId)",
  "error ERC721IncorrectOwner(address sender, uint256 tokenId, address owner)",
  "error ERC721InsufficientApproval(address operator, uint256 tokenId)",
  "error OwnableUnauthorizedAccount(address account)",
  "error ReentrancyGuardReentrantCall()",
  "error UnexpectedGeneration()",
  "error NoTemporaryFriend()",
  "error NotTokenOwner()",
  "error NotAuthorized()",
]);

const SIGNATURES = [
  "ERC20InsufficientAllowance(address,uint256,uint256)",
  "ERC20InsufficientBalance(address,uint256,uint256)",
  "ERC20InvalidReceiver(address)",
  "ERC20InvalidSender(address)",
  "ERC721NonexistentToken(uint256)",
  "ERC721IncorrectOwner(address,uint256,address)",
  "ERC721InsufficientApproval(address,uint256)",
  "OwnableUnauthorizedAccount(address)",
  "ReentrancyGuardReentrantCall()",
  "UnexpectedGeneration()",
  "NoTemporaryFriend()",
  "NotTokenOwner()",
  "NotAuthorized()",
  "Error(string)",
  "Panic(uint256)",
] as const;

/** selector -> error name, e.g. 0xfb8f41b2 -> ERC20InsufficientAllowance. */
export const KNOWN_REVERTS: ReadonlyMap<Hex, string> = new Map(
  SIGNATURES.map((sig) => [toFunctionSelector(sig).toLowerCase() as Hex, sig.slice(0, sig.indexOf("("))]),
);

export interface DecodedRevert {
  selector: Hex;
  reason: string;
}

function isHex(v: unknown): v is Hex {
  return typeof v === "string" && /^0x[0-9a-fA-F]*$/.test(v);
}

/** Finds raw revert data anywhere in a viem error's cause chain. */
export function extractRevertData(error: unknown): Hex | undefined {
  for (const e of errorChain(error)) {
    if (typeof e !== "object" || e === null || !("data" in e)) continue;
    const data: unknown = (e as { data: unknown }).data;
    if (isHex(data) && data.length >= 10) return data;
    if (typeof data === "object" && data !== null && "data" in data) {
      const inner: unknown = (data as { data: unknown }).data;
      if (isHex(inner) && inner.length >= 10) return inner;
    }
  }
  return undefined;
}

function formatArg(v: unknown): string {
  return typeof v === "bigint" ? v.toString() : String(v);
}

/** Decodes revert data into a selector and a human reason; unknown selectors keep the hex. */
export function decodeRevertData(data: Hex): DecodedRevert {
  const selector = data.slice(0, 10).toLowerCase() as Hex;
  try {
    const decoded = decodeErrorResult({ abi: REVERT_ABI, data });
    const args = (decoded.args ?? []).map(formatArg);
    return { selector, reason: `${decoded.errorName}(${args.join(", ")})` };
  } catch {
    const name = KNOWN_REVERTS.get(selector);
    return { selector, reason: name ?? `unknown revert ${selector}` };
  }
}

function shortMessage(error: unknown): string {
  for (const e of errorChain(error)) {
    if (e instanceof BaseError) return e.shortMessage;
  }
  return error instanceof Error ? error.message : String(error);
}

/** eth_call then eth_estimateGas as `from`. Read-only: the transaction is never sent. */
export async function dryRun(client: NestClient, from: Address, tx: PreparedTx): Promise<DryRunResult> {
  try {
    await client.call({ account: from, to: tx.to, data: tx.data, value: tx.value });
    const gas = await client.estimateGas({ account: from, to: tx.to, data: tx.data, value: tx.value });
    return { ok: true, gas };
  } catch (error) {
    const data = extractRevertData(error);
    if (data !== undefined) {
      const { selector, reason } = decodeRevertData(data);
      return { ok: false, revertSelector: selector, revertReason: reason };
    }
    return { ok: false, revertReason: shortMessage(error) };
  }
}

/**
 * Dry-runs a sequence as one block via eth_simulateV1 (viem `simulateCalls`), so an `approve`
 * is in effect when the following action runs. Falls back to independent calls when the RPC
 * lacks eth_simulateV1. Read-only: nothing is signed or sent.
 */
export async function dryRunAll(client: NestClient, from: Address, txs: PreparedTx[]): Promise<DryRunResult[]> {
  if (txs.length === 0) return [];
  try {
    const { results } = await withRetry(() =>
      client.simulateCalls({
        account: from,
        calls: txs.map((tx) => ({ to: tx.to, data: tx.data, value: tx.value })),
      }),
    );
    return results.map((r) => {
      if (r.status === "success") return { ok: true, gas: r.gasUsed };
      const data = isHex(r.data) && r.data.length > 2 ? r.data : undefined;
      if (data !== undefined) {
        const { selector, reason } = decodeRevertData(data);
        return { ok: false, revertSelector: selector, revertReason: reason };
      }
      return { ok: false, revertReason: r.error?.message ?? "reverted" };
    });
  } catch {
    const results: DryRunResult[] = [];
    for (const tx of txs) {
      const r = await dryRun(client, from, tx);
      results.push(r);
      if (!r.ok) break;
    }
    return results;
  }
}
