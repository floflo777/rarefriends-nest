/**
 * Hardwired census: `Hardwired(address indexed holder, uint256 indexed tokenId, uint8 generation)` on
 * ActivationManager. The state is an exact aggregate (counts + wallet set) that merges by addition, so
 * incremental runs only scan new blocks.
 */
import { getAbiItem, getAddress, type Address } from "viem";
import { ACTIVATION_MANAGER_ABI, ADDRESSES, type Snapshot } from "@nest/core";
import type { Rpc } from "./rpc.js";

/** Block of the first Hardwired event ever emitted (verified 2026-09-30). */
export const HARDWIRED_FIRST_BLOCK = 64_590_957n;

export interface HardwiredEvent {
  holder: Address;
  tokenId: bigint;
  generation: number;
  blockNumber: bigint;
}

export interface HardwiredState {
  /** Inclusive block range covered by this state. */
  fromBlock: number;
  toBlock: number;
  /** Block of the earliest event seen, null when no event yet. */
  firstBlock: number | null;
  total: number;
  byGeneration: Record<string, number>;
  /** Lower-cased distinct holders. */
  wallets: string[];
}

export function emptyHardwiredState(fromBlock: bigint): HardwiredState {
  return { fromBlock: Number(fromBlock), toBlock: Number(fromBlock) - 1, firstBlock: null, total: 0, byGeneration: {}, wallets: [] };
}

/** Pure: fold events into a state covering up to `toBlock`. */
export function applyHardwiredEvents(state: HardwiredState, events: readonly HardwiredEvent[], toBlock: bigint): HardwiredState {
  const byGeneration = { ...state.byGeneration };
  const wallets = new Set(state.wallets);
  let firstBlock = state.firstBlock;
  for (const e of events) {
    const g = String(e.generation);
    byGeneration[g] = (byGeneration[g] ?? 0) + 1;
    wallets.add(e.holder.toLowerCase());
    const b = Number(e.blockNumber);
    if (firstBlock === null || b < firstBlock) firstBlock = b;
  }
  return {
    fromBlock: state.fromBlock,
    toBlock: Number(toBlock),
    firstBlock,
    total: state.total + events.length,
    byGeneration,
    wallets: [...wallets].sort(),
  };
}

export function toSnapshotHardwired(state: HardwiredState): Snapshot["hardwired"] {
  const byGeneration: Record<string, number> = {};
  for (const g of Object.keys(state.byGeneration).sort((a, b) => Number(a) - Number(b))) byGeneration[g] = state.byGeneration[g] ?? 0;
  return { total: state.total, byGeneration, wallets: state.wallets.length, firstBlock: state.firstBlock ?? 0 };
}

const HARDWIRED_EVENT = getAbiItem({ abi: ACTIVATION_MANAGER_ABI, name: "Hardwired" });

export async function indexHardwired(rpc: Rpc, fromBlock: bigint, toBlock: bigint, log: (msg: string) => void = () => {}): Promise<HardwiredEvent[]> {
  const events: HardwiredEvent[] = [];
  if (fromBlock > toBlock) return events;
  const scan = rpc.scanLogs({ fromBlock, toBlock, label: "hardwired.getLogs" }, (from, to) =>
    rpc.client.getLogs({ address: ADDRESSES.activationManager, event: HARDWIRED_EVENT, fromBlock: from, toBlock: to, strict: true }),
  );
  for await (const chunk of scan) {
    for (const l of chunk.logs) {
      if (l.blockNumber === null) continue;
      events.push({ holder: getAddress(l.args.holder), tokenId: l.args.tokenId, generation: Number(l.args.generation), blockNumber: l.blockNumber });
    }
    log(`hardwired: blocks ${chunk.fromBlock}..${chunk.toBlock} (window ${chunk.window}) -> ${chunk.logs.length} events, total ${events.length}`);
  }
  return events;
}
