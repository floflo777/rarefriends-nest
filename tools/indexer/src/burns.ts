/**
 * RF burn indexing. A burn is an ERC-20 `Transfer(from, to = 0x0)` on the RF token. Protocol burns come
 * from ActivationManager; the transaction sender is the household and the calldata selector tells the
 * action. Transfers to 0x0 from any other address are kept aside as "foreign" burns so the total can be
 * reconciled against the supply drop.
 */
import { getAbiItem, getAddress, TransactionNotFoundError, type Address, type Hex } from "viem";
import { ACTION_SELECTORS, ADDRESSES, ERC20_ABI, type ActionName, type BurnRecord } from "@nest/core";
import type { Rpc } from "./rpc.js";

/** One burn log. A transaction may hold several, hence `logIndex` in the merge key. */
export interface IndexedBurn extends BurnRecord {
  logIndex: number;
}

/** RF sent to 0x0 by something other than ActivationManager. */
export interface ForeignBurn {
  txHash: Hex;
  blockNumber: bigint;
  logIndex: number;
  from: Address;
  burnedRf: bigint;
}

export interface BurnIndexResult {
  records: IndexedBurn[];
  foreign: ForeignBurn[];
  fromBlock: bigint;
  toBlock: bigint;
}

export interface BurnIndexOptions {
  log?: (msg: string) => void;
}

const TRANSFER_EVENT = getAbiItem({ abi: ERC20_ABI, name: "Transfer" });
const ACTIVATION_MANAGER = ADDRESSES.activationManager.toLowerCase();

/** Classify a transaction by the first 4 bytes of its calldata. */
export function classifySelector(input: string | undefined | null): ActionName | "unknown" {
  if (!input || input.length < 10) return "unknown";
  const selector = input.slice(0, 10).toLowerCase();
  return (ACTION_SELECTORS as Record<string, ActionName>)[selector] ?? "unknown";
}

export function burnKey(r: { txHash: string; logIndex: number }): string {
  return `${r.txHash.toLowerCase()}:${r.logIndex}`;
}

interface RawBurnLog {
  txHash: Hex;
  blockNumber: bigint;
  logIndex: number;
  from: Address;
  value: bigint;
}

export async function indexBurns(rpc: Rpc, fromBlock: bigint, toBlock: bigint, opts: BurnIndexOptions = {}): Promise<BurnIndexResult> {
  const log = opts.log ?? (() => {});
  const result: BurnIndexResult = { records: [], foreign: [], fromBlock, toBlock };
  if (fromBlock > toBlock) return result;

  // 1. All RF transfers to 0x0 in the range.
  const raw: RawBurnLog[] = [];
  const scan = rpc.scanLogs({ fromBlock, toBlock, label: "burns.getLogs" }, (from, to) =>
    rpc.client.getLogs({ address: ADDRESSES.rf, event: TRANSFER_EVENT, args: { to: ADDRESSES.zero }, fromBlock: from, toBlock: to, strict: true }),
  );
  for await (const chunk of scan) {
    for (const l of chunk.logs) {
      if (l.blockNumber === null || l.transactionHash === null || l.logIndex === null) continue; // pending logs never happen here
      raw.push({ txHash: l.transactionHash, blockNumber: l.blockNumber, logIndex: l.logIndex, from: l.args.from, value: l.args.value });
    }
    const pct = Number(((chunk.toBlock - fromBlock + 1n) * 1000n) / (toBlock - fromBlock + 1n)) / 10;
    log(`burns: blocks ${chunk.fromBlock}..${chunk.toBlock} (window ${chunk.window}) -> ${chunk.logs.length} logs, total ${raw.length}, ${pct.toFixed(1)}%`);
  }

  const protocol = raw.filter((r) => r.from.toLowerCase() === ACTIVATION_MANAGER);
  for (const r of raw) {
    if (r.from.toLowerCase() !== ACTIVATION_MANAGER) {
      result.foreign.push({ txHash: r.txHash, blockNumber: r.blockNumber, logIndex: r.logIndex, from: getAddress(r.from), burnedRf: r.value });
    }
  }
  log(`burns: ${raw.length} burn logs, ${protocol.length} from ActivationManager, ${result.foreign.length} foreign`);

  // 2. Sender and selector for every distinct transaction.
  const txHashes = [...new Set(protocol.map((r) => r.txHash))];
  const txInfo = new Map<Hex, { from: Address; action: ActionName | "unknown" }>();
  let missingTx = 0;
  await rpc.batch(
    "burns.getTransaction",
    txHashes,
    async (hash) => {
      try {
        const tx = await rpc.client.getTransaction({ hash });
        txInfo.set(hash, { from: getAddress(tx.from), action: classifySelector(tx.input) });
      } catch (err) {
        if (err instanceof TransactionNotFoundError) {
          missingTx++;
          return;
        }
        throw err;
      }
    },
    (done, total) => {
      if (done % (rpc.batchSize * 25) === 0 || done === total) log(`burns: transactions ${done}/${total}`);
    },
  );
  if (missingTx > 0) log(`burns: WARNING ${missingTx} transactions not found; their burns are attributed to 0x0/unknown`);

  // 3. Timestamps for every distinct block.
  const blocks = [...new Set(protocol.map((r) => r.blockNumber))];
  const timestamps = new Map<bigint, number>();
  await rpc.batch(
    "burns.getBlock",
    blocks,
    async (blockNumber) => {
      const block = await rpc.client.getBlock({ blockNumber, includeTransactions: false });
      timestamps.set(blockNumber, Number(block.timestamp));
    },
    (done, total) => {
      if (done % (rpc.batchSize * 25) === 0 || done === total) log(`burns: blocks ${done}/${total}`);
    },
  );

  // 4. Assemble.
  for (const r of protocol) {
    const info = txInfo.get(r.txHash) ?? { from: ADDRESSES.zero, action: "unknown" as const };
    const timestamp = timestamps.get(r.blockNumber);
    if (timestamp === undefined) throw new Error(`burns: no timestamp for block ${r.blockNumber}`);
    result.records.push({
      txHash: r.txHash,
      blockNumber: r.blockNumber,
      logIndex: r.logIndex,
      timestamp,
      from: info.from,
      action: info.action,
      burnedRf: r.value,
    });
  }
  result.records.sort(compareByPosition);
  result.foreign.sort(compareByPosition);
  return result;
}

export function compareByPosition(a: { blockNumber: bigint; logIndex: number }, b: { blockNumber: bigint; logIndex: number }): number {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
  return a.logIndex - b.logIndex;
}

/**
 * Merge freshly indexed records into the cached ones. Cached records at or after `reindexFrom` are
 * dropped first (that range was re-scanned), then the union is de-duplicated on (txHash, logIndex).
 */
export function mergeBurns<T extends { txHash: Hex; blockNumber: bigint; logIndex: number }>(cached: readonly T[], fresh: readonly T[], reindexFrom: bigint): T[] {
  const byKey = new Map<string, T>();
  for (const r of cached) if (r.blockNumber < reindexFrom) byKey.set(burnKey(r), r);
  for (const r of fresh) byKey.set(burnKey(r), r);
  return [...byKey.values()].sort(compareByPosition);
}
