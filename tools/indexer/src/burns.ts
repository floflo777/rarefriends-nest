/**
 * RF burn indexing. A burn is an ERC-20 `Transfer(from, to = 0x0)` on the RF token. Protocol burns come
 * from ActivationManager; the transaction sender is the household and the calldata selector tells the
 * action. Transfers to 0x0 from any other address are kept aside as "foreign" burns so the total can be
 * reconciled against the supply drop.
 *
 * Per distinct block one `eth_getBlockByNumber(block, true)` gives the timestamp and every transaction's
 * sender and calldata, which is cheaper on the rate limiter than one getTransaction per tx plus one
 * getBlock per block. Transactions whose selector is not a known action are then classified from their
 * receipt (Hardwired / Promoted events). Each getLogs window is fully resolved and handed to `onWindow`
 * before the next one, so callers can persist partial progress.
 */
import { getAbiItem, getAddress, type Address, type Hex } from "viem";
import { ACTION_SELECTORS, ADDRESSES, ERC20_ABI, type ActionName, type BurnRecord } from "@nest/core";
import { ACTIVATION_MANAGER_TOPICS } from "./events.js";
import type { Rpc } from "./rpc.js";

/** One burn log. A transaction may hold several, hence `logIndex` in the merge key. */
export interface IndexedBurn extends BurnRecord {
  logIndex: number;
  /** First 4 bytes of the calldata ("0x" when shorter); null when the transaction was never resolved (older cache lines). */
  selector: Hex | null;
  /** Calldata ends with the Nest tag. */
  viaNest: boolean;
  /** The receipt was inspected because the selector was unknown. */
  receiptChecked: boolean;
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

/** Nest appends this 6-byte tag to the calldata of every transaction it prepares. */
export const NEST_TAG = "4e4553540001";

const TRANSFER_EVENT = getAbiItem({ abi: ERC20_ABI, name: "Transfer" });
const ACTIVATION_MANAGER = ADDRESSES.activationManager.toLowerCase();

/** First 4 bytes of calldata, lower-cased; "0x" when the input is shorter than a selector. */
export function selectorOf(input: string | undefined | null): Hex {
  if (!input || input.length < 10) return "0x";
  return input.slice(0, 10).toLowerCase() as Hex;
}

/** Classify a transaction by the first 4 bytes of its calldata. */
export function classifySelector(input: string | undefined | null): ActionName | "unknown" {
  const selector = selectorOf(input);
  return (ACTION_SELECTORS as Record<string, ActionName>)[selector] ?? "unknown";
}

/** True when the calldata ends with the Nest tag (and has a selector before it). */
export function isViaNest(input: string | undefined | null): boolean {
  if (!input || input.length < 10 + NEST_TAG.length) return false;
  return input.toLowerCase().endsWith(NEST_TAG);
}

/**
 * Classify a transaction from its receipt logs: a `Hardwired` event on ActivationManager means hardwire,
 * else a `Promoted` event means promote. Upgrade and activate have no decoded event, they stay unknown.
 */
export function classifyByReceipt(logs: readonly { address: Address; topics: readonly Hex[] }[]): ActionName | "unknown" {
  let result: ActionName | "unknown" = "unknown";
  for (const l of logs) {
    if (l.address.toLowerCase() !== ACTIVATION_MANAGER) continue;
    const topic = l.topics[0]?.toLowerCase();
    if (topic === ACTIVATION_MANAGER_TOPICS.Hardwired) return "hardwire";
    if (topic === ACTIVATION_MANAGER_TOPICS.Promoted) result = "promote";
  }
  return result;
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
  selector: Hex;
  action: ActionName | "unknown";
  viaNest: boolean;
}

interface BlockInfo {
  txInfo: Map<string, TxInfo>;
  timestamps: Map<bigint, number>;
}

/** Fetch the given blocks with their transactions: timestamps plus sender/calldata facts per tx hash. */
async function fetchBlocks(rpc: Rpc, blocks: readonly bigint[], log: (msg: string) => void, label = "burns.getBlock"): Promise<BlockInfo> {
  const info: BlockInfo = { txInfo: new Map(), timestamps: new Map() };
  await rpc.batch(
    label,
    blocks,
    async (blockNumber) => {
      const block = await rpc.client.getBlock({ blockNumber, includeTransactions: true });
      info.timestamps.set(blockNumber, Number(block.timestamp));
      for (const tx of block.transactions) {
        if (typeof tx === "string") continue;
        info.txInfo.set(tx.hash.toLowerCase(), { from: getAddress(tx.from), selector: selectorOf(tx.input), action: classifySelector(tx.input), viaNest: isViaNest(tx.input) });
      }
    },
    (done, total) => {
      if (done % (rpc.batchSize * 25) === 0 || done === total) log(`${label}: ${done}/${total} blocks (pace x${rpc.paceFactor.toFixed(2)})`);
    },
  );
  return info;
}

/** Apply block facts to burn records in place. Records whose transaction is missing keep their previous facts. */
function applyBlockInfo(records: IndexedBurn[], info: BlockInfo, log: (msg: string) => void): void {
  let missing = 0;
  for (const r of records) {
    const timestamp = info.timestamps.get(r.blockNumber);
    if (timestamp !== undefined) r.timestamp = timestamp;
    const tx = info.txInfo.get(r.txHash.toLowerCase());
    if (tx === undefined) {
      missing++;
      continue;
    }
    r.from = tx.from;
    r.selector = tx.selector;
    r.action = tx.action;
    r.viaNest = tx.viaNest;
    r.receiptChecked = false;
  }
  if (missing > 0) log(`burns: WARNING ${missing} burns whose transaction is absent from its block payload`);
}

/**
 * Inspect the receipts of transactions whose selector is unknown and not yet checked; updates `action`
 * and `receiptChecked` in place. Returns the number of records that got a real action.
 */
export async function classifyUnknownByReceipt(rpc: Rpc, records: IndexedBurn[], log: (msg: string) => void = () => {}): Promise<number> {
  const pending = records.filter((r) => r.action === "unknown" && !r.receiptChecked);
  if (pending.length === 0) return 0;
  const hashes = [...new Set(pending.map((r) => r.txHash.toLowerCase() as Hex))];
  log(`burns: inspecting ${hashes.length} receipts for ${pending.length} unknown burns`);
  const byTx = new Map<string, ActionName | "unknown">();
  await rpc.batch(
    "burns.getTransactionReceipt",
    hashes,
    async (hash) => {
      const receipt = await rpc.client.getTransactionReceipt({ hash });
      byTx.set(hash, classifyByReceipt(receipt.logs));
    },
    (done, total) => {
      if (done % (rpc.batchSize * 25) === 0 || done === total) log(`burns.getTransactionReceipt: ${done}/${total}`);
    },
  );
  let reclassified = 0;
  for (const r of pending) {
    const action = byTx.get(r.txHash.toLowerCase());
    if (action === undefined) continue;
    r.receiptChecked = true;
    if (action !== "unknown") {
      r.action = action;
      reclassified++;
    }
  }
  log(`burns: ${reclassified} unknown burns reclassified from receipts, ${pending.length - reclassified} still unknown`);
  return reclassified;
}

/** Resolve sender, selector, action, Nest tag and timestamp for the protocol burns of one window. */
async function resolveWindow(rpc: Rpc, protocol: RawBurnLog[], log: (msg: string) => void): Promise<IndexedBurn[]> {
  const records: IndexedBurn[] = protocol.map((r) => ({
    txHash: r.txHash,
    blockNumber: r.blockNumber,
    logIndex: r.logIndex,
    timestamp: 0,
    from: ADDRESSES.zero,
    action: "unknown",
    burnedRf: r.value,
    selector: null,
    viaNest: false,
    receiptChecked: false,
  }));
  const info = await fetchBlocks(rpc, [...new Set(protocol.map((r) => r.blockNumber))], log);
  applyBlockInfo(records, info, log);
  for (const r of records) if (r.timestamp === 0) throw new Error(`burns: no timestamp for block ${r.blockNumber}`);
  await classifyUnknownByReceipt(rpc, records, log);
  records.sort(compareByPosition);
  return records;
}

export interface ReresolveOptions {
  log?: (msg: string) => void;
  /** Blocks per slice; `onSlice` runs after each so progress can be persisted. */
  sliceBlocks?: number;
  onSlice?: (doneBlocks: number, totalBlocks: number) => Promise<void> | void;
}

/**
 * Re-fetch the blocks of records that were never resolved with the current facts (selector null) and
 * update them in place, then classify the remaining unknowns from receipts.
 */
export async function reresolve(rpc: Rpc, records: IndexedBurn[], opts: ReresolveOptions = {}): Promise<number> {
  const log = opts.log ?? (() => {});
  const stale = records.filter((r) => r.selector === null);
  const blocks = [...new Set(stale.map((r) => r.blockNumber))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  log(`reresolve: ${stale.length} records in ${blocks.length} blocks`);
  const slice = opts.sliceBlocks ?? 1_000;
  for (let i = 0; i < blocks.length; i += slice) {
    const part = blocks.slice(i, i + slice);
    const set = new Set(part);
    const info = await fetchBlocks(rpc, part, log, "reresolve.getBlock");
    applyBlockInfo(stale.filter((r) => set.has(r.blockNumber)), info, log);
    await opts.onSlice?.(Math.min(i + part.length, blocks.length), blocks.length);
  }
  await classifyUnknownByReceipt(rpc, records, log);
  return stale.length;
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
