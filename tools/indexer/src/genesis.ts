/**
 * Genesis activation census: `positions(genesis, id)` for id 1..1024 (weight > 0 = activated), then
 * `ownerOf` on the inactive ones to count how many still sit in the reserve wallet.
 * Read at the latest block: the public node prunes historical state.
 */
import { getAddress, type Address } from "viem";
import { ACTIVATION_MANAGER_ABI, ADDRESSES, GENESIS_ABI, type Snapshot } from "@nest/core";
import type { Rpc } from "./rpc.js";

export const GENESIS_RESERVE: Address = "0xA850B2499c064900EfF341745807e1cB0d71a52b";
export const GENESIS_SUPPLY = 1024;
const MULTICALL_CHUNK = 256;

export interface GenesisToken {
  id: number;
  tier: number;
  weight: bigint;
  /** Owner of an inactive token; null when not read (active token) or when ownerOf failed. */
  owner: Address | null;
}

type GenesisCounts = Snapshot["genesis"];

export interface GenesisSummary extends GenesisCounts {
  /** Inactive tokens grouped by owner (checksummed), descending. */
  inactiveByOwner: Record<string, number>;
  /** Tokens whose `positions` or `ownerOf` call failed. */
  unreadable: number;
}

/** Pure: summarise a census. */
export function summarizeGenesis(tokens: readonly GenesisToken[], reserve: Address = GENESIS_RESERVE): GenesisSummary {
  const reserveLc = reserve.toLowerCase();
  let activated = 0;
  let inactive = 0;
  let reserveHeld = 0;
  let unreadable = 0;
  const counts = new Map<string, number>();
  for (const t of tokens) {
    if (t.weight > 0n) {
      activated++;
      continue;
    }
    inactive++;
    if (t.owner === null) {
      unreadable++;
      continue;
    }
    if (t.owner.toLowerCase() === reserveLc) reserveHeld++;
    counts.set(t.owner, (counts.get(t.owner) ?? 0) + 1);
  }
  const inactiveByOwner: Record<string, number> = {};
  for (const [owner, n] of [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) inactiveByOwner[owner] = n;
  return { activated, inactive, reserveHeld, inactiveByOwner, unreadable };
}

interface MulticallItem {
  status: "success" | "failure";
  error?: unknown;
}

/**
 * viem's multicall with `allowFailure` turns a failed eth_call (for instance an HTTP 429) into one failure
 * per sub-call, which would silently miscount the census. A chunk where every call failed is treated as a
 * request error so `Rpc.call` retries it.
 */
function rejectWholeChunkFailure<T extends MulticallItem>(results: T[]): T[] {
  if (results.length > 0 && results.every((r) => r.status === "failure")) {
    throw results[0]?.error ?? new Error("multicall: every call failed");
  }
  return results;
}

export async function censusGenesis(rpc: Rpc, log: (msg: string) => void = () => {}): Promise<{ summary: GenesisSummary; blockNumber: number; tokens: GenesisToken[] }> {
  const blockNumber = Number(await rpc.call("genesis.blockNumber", () => rpc.client.getBlockNumber()));
  const ids = Array.from({ length: GENESIS_SUPPLY }, (_, i) => i + 1);
  const tokens: GenesisToken[] = [];
  let positionFailures = 0;

  for (let i = 0; i < ids.length; i += MULTICALL_CHUNK) {
    const chunk = ids.slice(i, i + MULTICALL_CHUNK);
    const results = await rpc.call(`genesis.positions[${chunk[0]}..${chunk[chunk.length - 1]}]`, async () =>
      rejectWholeChunkFailure(
        await rpc.client.multicall({
          contracts: chunk.map((id) => ({
            address: ADDRESSES.activationManager,
            abi: ACTIVATION_MANAGER_ABI,
            functionName: "positions",
            args: [ADDRESSES.genesis, BigInt(id)],
          })),
          allowFailure: true,
          batchSize: 0,
        }),
      ),
    );
    results.forEach((r, j) => {
      const id = chunk[j];
      if (id === undefined) return;
      if (r.status === "success") {
        const [tier, weight] = r.result as unknown as readonly [number, bigint];
        tokens.push({ id, tier: Number(tier), weight, owner: null });
      } else {
        positionFailures++;
        tokens.push({ id, tier: 0, weight: 0n, owner: null });
      }
    });
    log(`genesis: positions ${tokens.length}/${GENESIS_SUPPLY}`);
  }

  const inactive = tokens.filter((t) => t.weight === 0n);
  for (let i = 0; i < inactive.length; i += MULTICALL_CHUNK) {
    const chunk = inactive.slice(i, i + MULTICALL_CHUNK);
    const results = await rpc.call(`genesis.ownerOf[${i}..${i + chunk.length - 1}]`, async () =>
      rejectWholeChunkFailure(
        await rpc.client.multicall({
          contracts: chunk.map((t) => ({ address: ADDRESSES.genesis, abi: GENESIS_ABI, functionName: "ownerOf", args: [BigInt(t.id)] })),
          allowFailure: true,
          batchSize: 0,
        }),
      ),
    );
    results.forEach((r, j) => {
      const t = chunk[j];
      if (t && r.status === "success") t.owner = getAddress(r.result);
    });
    log(`genesis: owners ${Math.min(i + chunk.length, inactive.length)}/${inactive.length}`);
  }

  const summary = summarizeGenesis(tokens);
  if (positionFailures > 0) throw new Error(`genesis: ${positionFailures} positions() calls failed; refusing to publish a wrong census`);
  return { summary, blockNumber, tokens };
}
