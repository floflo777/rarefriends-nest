/**
 * RF burn indexing. A burn is an ERC-20 `Transfer(from, to = 0x0)` on the RF token. Protocol burns come
 * from ActivationManager; the transaction sender is the household and the calldata selector tells the
 * action. Transfers to 0x0 from any other address are kept aside as "foreign" burns so the total can be
 * reconciled against the supply drop.
 *
 * Per distinct block one `eth_getBlockByNumber(block, true)` gives the timestamp and every transaction's
 * sender and calldata, which is cheaper on the rate limiter than one getTransaction per tx plus one
 * getBlock per block. Each getLogs window is fully resolved and handed to `onWindow` before the next one,
 * so callers can persist partial progress.
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

export interface BurnWindow {
  records: IndexedBurn[];
  foreign: ForeignBurn[];
  fromBlock: bigint;
  toBlock: bigint;
}

export interface BurnIndexResult extends BurnWindow {
  windows: number;
}

export interface BurnIndexOptions {
  log?: (msg: string) => void;
  /** Scan direction; "backward" resolves the newest window first. */
  direction?: "forward" | "backward";
  /** Called after each fully resolved getLogs window. */
  onWindow?: (window: BurnWindow) => Promise<void> | void;
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

interface TxInfo {
  from: Address;
  action: ActionName | "unknown";
}

/** Resolve sender, action and timestamp for the protocol burns of one window. */
async function resolveWindow(rpc: Rpc, protocol: RawBurnLog[], log: (msg: string) => void): Promise<IndexedBurn[]> {
  const txInfo = new Map<string, TxInfo>();
  const timestamps = new Map<bigint, number>();
  const blocks = [...new Set(protocol.map((r) => r.blockNumber))];
  await rpc.batch(
    "burns.getBlock",
    blocks,
    async (blockNumber) => {
      const block = await rpc.client.getBlock({ blockNumber, includeTransactions: true });
      timestamps.set(blockNumber, Number(block.timestamp));
      for (const tx of block.transactions) {
        if (typeof tx === "string") continue;
        txInfo.set(tx.hash.toLowerCase(), { from: getAddress(tx.from), action: classifySelector(tx.input) });
      }
    },
    (done, total) => {
      if (done % (rpc.batchSize * 25) === 0 || done === total) log(`burns: blocks ${done}/${total} (pace x${rpc.paceFactor.toFixed(2)})`);
    },
  );

  // Transactions missing from their block payload (should not happen): fetch them one by one.
  const missing = [...new Set(protocol.map((r) => r.txHash).filter((h) => !txInfo.has(h.toLowerCase())))];
  if (missing.length > 0) {
    log(`burns: ${missing.length} transactions absent from block payloads, fetching individually`);
    await rpc.batch("burns.getTransaction", missing, async (hash) => {
      try {
        const tx = await rpc.client.getTransaction({ hash });
        txInfo.set(hash.toLowerCase(), { from: getAddress(tx.from), action: classifySelector(tx.input) });
      } catch (err) {
        if (!(err instanceof TransactionNotFoundError)) throw err;
      }
    });
  }

  const records: IndexedBurn[] = [];
  let unattributed = 0;
  for (const r of protocol) {
    const info = txInfo.get(r.txHash.toLowerCase());
    if (info === undefined) unattributed++;
    const timestamp = timestamps.get(r.blockNumber);
    if (timestamp === undefined) throw new Error(`burns: no timestamp for block ${r.blockNumber}`);
    records.push({
      txHash: r.txHash,
      blockNumber: r.blockNumber,
      logIndex: r.logIndex,
      timestamp,
      from: info?.from ?? ADDRESSES.zero,
      action: info?.action ?? "unknown",
      burnedRf: r.value,
    });
  }
  if (unattributed > 0) log(`burns: WARNING ${unattributed} burns attributed to 0x0/unknown (transaction not found)`);
  records.sort(compareByPosition);
  return records;
}

export async function indexBurns(rpc: Rpc, fromBlock: bigint, toBlock: bigint, opts: BurnIndexOptions = {}): Promise<BurnIndexResult> {
  const log = opts.log ?? (() => {});
  const result: BurnIndexResult = { records: [], foreign: [], fromBlock, toBlock, windows: 0 };
  if (fromBlock > toBlock) return result;
  const span = toBlock - fromBlock + 1n;
  let covered = 0n;

  const scan = rpc.scanLogs({ fromBlock, toBlock, label: "burns.getLogs", ...(opts.direction ? { direction: opts.direction } : {}) }, (from, to) =>
    rpc.client.getLogs({ address: ADDRESSES.rf, event: TRANSFER_EVENT, args: { to: ADDRESSES.zero }, fromBlock: from, toBlock: to, strict: true }),
  );
  for await (const chunk of scan) {
    const protocol: RawBurnLog[] = [];
    const foreign: ForeignBurn[] = [];
    for (const l of chunk.logs) {
      if (l.blockNumber === null || l.transactionHash === null || l.logIndex === null) continue; // pending logs never happen here
      const raw: RawBurnLog = { txHash: l.transactionHash, blockNumber: l.blockNumber, logIndex: l.logIndex, from: l.args.from, value: l.args.value };
      if (raw.from.toLowerCase() === ACTIVATION_MANAGER) protocol.push(raw);
      else foreign.push({ txHash: raw.txHash, blockNumber: raw.blockNumber, logIndex: raw.logIndex, from: getAddress(raw.from), burnedRf: raw.value });
    }
    covered += chunk.toBlock - chunk.fromBlock + 1n;
    const pct = Number((covered * 1000n) / span) / 10;
    log(`burns: blocks ${chunk.fromBlock}..${chunk.toBlock} (window ${chunk.window}) -> ${protocol.length} protocol + ${foreign.length} foreign burns, ${pct.toFixed(1)}% of range`);

    const records = await resolveWindow(rpc, protocol, log);
    foreign.sort(compareByPosition);
    const window: BurnWindow = { records, foreign, fromBlock: chunk.fromBlock, toBlock: chunk.toBlock };
    result.records.push(...records);
    result.foreign.push(...foreign);
    result.windows++;
    await opts.onWindow?.(window);
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
 * Merge freshly indexed records into the cached ones. Cached records inside [reindexFrom, reindexTo] are
 * dropped first (that range was re-scanned), then the union is de-duplicated on (txHash, logIndex).
 */
export function mergeBurns<T extends { txHash: Hex; blockNumber: bigint; logIndex: number }>(
  cached: readonly T[],
  fresh: readonly T[],
  reindexFrom: bigint,
  reindexTo: bigint = 2n ** 63n,
): T[] {
  const byKey = new Map<string, T>();
  for (const r of cached) if (r.blockNumber < reindexFrom || r.blockNumber > reindexTo) byKey.set(burnKey(r), r);
  for (const r of fresh) byKey.set(burnKey(r), r);
  return [...byKey.values()].sort(compareByPosition);
}
