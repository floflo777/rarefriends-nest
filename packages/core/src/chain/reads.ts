/**
 * Read-only protocol reads. Everything goes through Multicall3 so a Friend costs two
 * eth_calls and a household a handful, well under the public RPC's rate limit.
 */
import { isAddressEqual, parseAbi, parseAbiItem } from "viem";
import type { Address, ContractFunctionParameters } from "viem";
import type { Collection, Friend, FriendIdentity, Household, ProtocolState, StreamState } from "../types.js";
import {
  ACTIVATION_MANAGER_ABI,
  ADDRESSES,
  ERC20_ABI,
  FAMILIES_REGISTRY_ABI,
  FAMILY_NAMES,
  GENERATIONS_ABI,
  GENESIS_ABI,
} from "../protocol/constants.js";
import { MULTICALL_BATCH_BYTES, errorMessages, isRateLimitError, withRetry } from "./client.js";
import type { NestClient } from "./client.js";

const MULTICALL3_ABI = parseAbi(["function getEthBalance(address addr) view returns (uint256)"]);
const ERC721_TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)");

/** Generations' first Transfer is at or before 64,590,957; Genesis is paged from the same block. */
export const DISCOVERY_START_BLOCK = 63_000_000n;
/** The public RPC rejects eth_getLogs spanning more than this many blocks. */
export const MAX_LOG_WINDOW = 10_000_000n;
const DEFAULT_LOG_WINDOW = 2_500_000n;
const MIN_LOG_WINDOW = 1_000n;
/** Friends per multicall round in household reads. */
export const FRIENDS_PER_BATCH = 40;

export class TemporaryFriendError extends Error {
  override readonly name = "TemporaryFriendError";
  constructor(
    readonly collection: Collection,
    readonly tokenId: bigint,
  ) {
    super(`${collection} #${tokenId} is a temporary Friend (generation 0): it has no owner yet, hardwire it first`);
  }
}

export class FriendReadError extends Error {
  override readonly name = "FriendReadError";
  constructor(
    readonly collection: Collection,
    readonly tokenId: bigint,
    detail: string,
  ) {
    super(`${collection} #${tokenId}: ${detail}`);
  }
}

export interface FriendRef {
  collection: Collection;
  tokenId: bigint;
}

export function collectionAddress(collection: Collection): Address {
  return collection === "Generations" ? ADDRESSES.generations : ADDRESSES.genesis;
}

type McResult = { status: "success"; result: unknown } | { status: "failure"; error: Error };

interface McOptions {
  blockNumber?: bigint;
  allowFailure?: boolean;
}

async function multicall(client: NestClient, contracts: ContractFunctionParameters[], options: McOptions = {}): Promise<McResult[]> {
  if (contracts.length === 0) return [];
  const results = await withRetry(() =>
    client.multicall({
      contracts,
      allowFailure: true,
      batchSize: MULTICALL_BATCH_BYTES,
      ...(options.blockNumber !== undefined ? { blockNumber: options.blockNumber } : {}),
    }),
  );
  const out: McResult[] = results.map((r) =>
    r.status === "success" ? { status: "success", result: r.result } : { status: "failure", error: r.error },
  );
  if (options.allowFailure === false) {
    const failed = out.findIndex((r) => r.status === "failure");
    if (failed >= 0) {
      const r = out[failed];
      const c = contracts[failed];
      const detail = r !== undefined && r.status === "failure" ? errorMessages(r.error) : "unknown";
      throw new Error(`multicall ${c?.functionName ?? "?"} on ${c?.address ?? "?"} failed: ${detail}`);
    }
  }
  return out;
}

function asBigint(v: unknown, label: string): bigint {
  if (typeof v === "bigint") return v;
  throw new TypeError(`${label}: expected bigint, got ${typeof v}`);
}

function asNumber(v: unknown, label: string): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  throw new TypeError(`${label}: expected number, got ${typeof v}`);
}

function asAddress(v: unknown, label: string): Address {
  if (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v)) return v as Address;
  throw new TypeError(`${label}: expected address, got ${String(v)}`);
}

function asTuple(v: unknown, label: string): readonly unknown[] {
  if (Array.isArray(v)) return v;
  throw new TypeError(`${label}: expected tuple`);
}

function success(r: McResult | undefined, label: string): unknown {
  if (r === undefined) throw new Error(`${label}: missing multicall result`);
  if (r.status === "failure") throw new Error(`${label}: ${errorMessages(r.error)}`);
  return r.result;
}

function toStream(v: unknown, label: string): StreamState {
  const t = asTuple(v, label);
  return {
    amount: asBigint(t[0], `${label}.amount`),
    periodFinish: asNumber(t[2], `${label}.periodFinish`),
    lastUpdate: asNumber(t[3], `${label}.lastUpdate`),
  };
}

const AM = ADDRESSES.activationManager;

export async function readProtocolState(client: NestClient): Promise<ProtocolState> {
  const block = await withRetry(() => client.getBlock({ blockTag: "latest" }));
  const contracts: ContractFunctionParameters[] = [
    { address: AM, abi: ACTIVATION_MANAGER_ABI, functionName: "totalWeight" },
    { address: AM, abi: ACTIVATION_MANAGER_ABI, functionName: "streams", args: [ADDRESSES.rf] },
    { address: AM, abi: ACTIVATION_MANAGER_ABI, functionName: "streams", args: [ADDRESSES.weth] },
    { address: ADDRESSES.rf, abi: ERC20_ABI, functionName: "totalSupply" },
  ];
  const r = await multicall(client, contracts, { blockNumber: block.number, allowFailure: false });
  return {
    blockNumber: block.number,
    timestamp: Number(block.timestamp),
    totalWeight: asBigint(success(r[0], "totalWeight"), "totalWeight"),
    rfStream: toStream(success(r[1], "streams(rf)"), "streams(rf)"),
    wethStream: toStream(success(r[2], "streams(weth)"), "streams(weth)"),
    rfTotalSupply: asBigint(success(r[3], "totalSupply"), "totalSupply"),
  };
}

/** Per-Friend identity calls, phase 1 (before the wallet address is known). */
function identityCalls(ref: FriendRef): { keys: string[]; contracts: ContractFunctionParameters[] } {
  const collection = collectionAddress(ref.collection);
  const id = ref.tokenId;
  const keys: string[] = [];
  const contracts: ContractFunctionParameters[] = [];
  const push = (key: string, c: ContractFunctionParameters): void => {
    keys.push(key);
    contracts.push(c);
  };
  if (ref.collection === "Generations") {
    push("ownerOf", { address: collection, abi: GENERATIONS_ABI, functionName: "ownerOf", args: [id] });
    push("wallet", { address: collection, abi: GENERATIONS_ABI, functionName: "tokenBoundAccount", args: [id] });
    push("generation", { address: collection, abi: GENERATIONS_ABI, functionName: "generation", args: [id] });
    push("family", { address: ADDRESSES.familiesRegistry, abi: FAMILIES_REGISTRY_ABI, functionName: "familyOf", args: [id] });
    push("seed", { address: ADDRESSES.familiesRegistry, abi: FAMILIES_REGISTRY_ABI, functionName: "seedOf", args: [id] });
  } else {
    push("ownerOf", { address: collection, abi: GENESIS_ABI, functionName: "ownerOf", args: [id] });
    push("wallet", { address: collection, abi: GENESIS_ABI, functionName: "tokenBoundAccount", args: [id] });
  }
  push("position", { address: AM, abi: ACTIVATION_MANAGER_ABI, functionName: "positions", args: [collection, id] });
  push("earnedRf", { address: AM, abi: ACTIVATION_MANAGER_ABI, functionName: "earned", args: [ADDRESSES.rf, collection, id] });
  push("earnedWeth", { address: AM, abi: ACTIVATION_MANAGER_ABI, functionName: "earned", args: [ADDRESSES.weth, collection, id] });
  return { keys, contracts };
}

function savingsCalls(wallet: Address): ContractFunctionParameters[] {
  return [
    { address: ADDRESSES.rf, abi: ERC20_ABI, functionName: "balanceOf", args: [wallet] },
    { address: ADDRESSES.weth, abi: ERC20_ABI, functionName: "balanceOf", args: [wallet] },
    { address: ADDRESSES.multicall3, abi: MULTICALL3_ABI, functionName: "getEthBalance", args: [wallet] },
  ];
}

export interface ReadOptions {
  /** Pin every call to one block for a consistent snapshot. */
  blockNumber?: bigint;
}

/** Reads up to FRIENDS_PER_BATCH Friends in two multicall rounds. */
async function readFriendBatch(client: NestClient, refs: FriendRef[], options: ReadOptions): Promise<Friend[]> {
  const plans = refs.map((ref) => ({ ref, ...identityCalls(ref) }));
  const phase1 = await multicall(client, plans.flatMap((p) => p.contracts), options);

  const identities: { identity: FriendIdentity; results: Map<string, McResult> }[] = [];
  let offset = 0;
  for (const plan of plans) {
    const results = new Map<string, McResult>();
    plan.keys.forEach((key, i) => {
      const r = phase1[offset + i];
      if (r !== undefined) results.set(key, r);
    });
    offset += plan.keys.length;
    const label = `${plan.ref.collection} #${plan.ref.tokenId}`;

    const generation = plan.ref.collection === "Generations" ? asNumber(success(results.get("generation"), `${label} generation`), "generation") : 0;
    const ownerResult = results.get("ownerOf");
    if (ownerResult === undefined || ownerResult.status === "failure") {
      if (plan.ref.collection === "Generations" && generation === 0) throw new TemporaryFriendError(plan.ref.collection, plan.ref.tokenId);
      const detail = ownerResult !== undefined && ownerResult.status === "failure" ? errorMessages(ownerResult.error) : "no result";
      throw new FriendReadError(plan.ref.collection, plan.ref.tokenId, `ownerOf reverted (token may not exist): ${detail}`);
    }
    const identity: FriendIdentity = {
      collection: plan.ref.collection,
      tokenId: plan.ref.tokenId,
      owner: asAddress(ownerResult.result, `${label} ownerOf`),
      wallet: asAddress(success(results.get("wallet"), `${label} tokenBoundAccount`), "wallet"),
      generation,
    };
    if (plan.ref.collection === "Generations") {
      const family = asNumber(success(results.get("family"), `${label} familyOf`), "family");
      const seed = asNumber(success(results.get("seed"), `${label} seedOf`), "seed");
      identity.family = family;
      identity.seed = seed;
      const familyName = FAMILY_NAMES[family];
      if (familyName !== undefined) identity.familyName = familyName;
    }
    identities.push({ identity, results });
  }

  const phase2 = await multicall(client, identities.flatMap((i) => savingsCalls(i.identity.wallet)), { ...options, allowFailure: false });

  return identities.map(({ identity, results }, i) => {
    const label = `${identity.collection} #${identity.tokenId}`;
    const pos = asTuple(success(results.get("position"), `${label} positions`), "positions");
    const weight = asBigint(pos[1], `${label} positions.weight`);
    const base = i * 3;
    return {
      ...identity,
      position: { tier: asNumber(pos[0], "tier"), weight, active: weight > 0n },
      rewards: {
        earnedRf: asBigint(success(results.get("earnedRf"), `${label} earned(rf)`), "earnedRf"),
        earnedWeth: asBigint(success(results.get("earnedWeth"), `${label} earned(weth)`), "earnedWeth"),
      },
      savings: {
        rf: asBigint(success(phase2[base], `${label} rf balance`), "rf"),
        weth: asBigint(success(phase2[base + 1], `${label} weth balance`), "weth"),
        eth: asBigint(success(phase2[base + 2], `${label} eth balance`), "eth"),
      },
    };
  });
}

export async function readFriends(client: NestClient, refs: FriendRef[], options: ReadOptions = {}): Promise<Friend[]> {
  const out: Friend[] = [];
  for (let i = 0; i < refs.length; i += FRIENDS_PER_BATCH) {
    out.push(...(await readFriendBatch(client, refs.slice(i, i + FRIENDS_PER_BATCH), options)));
  }
  return out;
}

/**
 * One Friend with owner, ERC-6551 wallet, generation, family/seed (Generations),
 * position, unclaimed rewards and the wallet's RF/WETH/ETH savings.
 * Throws TemporaryFriendError for a generation-0 Generations token (ownerOf reverts).
 */
export async function readFriend(client: NestClient, collection: Collection, tokenId: bigint, options: ReadOptions = {}): Promise<Friend> {
  const [friend] = await readFriends(client, [{ collection, tokenId }], options);
  if (friend === undefined) throw new FriendReadError(collection, tokenId, "empty read");
  return friend;
}

export function isLogLimitError(error: unknown): boolean {
  if (isRateLimitError(error)) return false;
  return /exceeds limit|are allowed for this request|narrow the block range|block range|too many results|query returned more than|response size|query timeout/i.test(
    errorMessages(error),
  );
}

export interface DiscoverOptions {
  /** Start paging from here instead of DISCOVERY_START_BLOCK (cache hint). */
  fromBlock?: bigint;
  toBlock?: bigint;
  /** Initial eth_getLogs window in blocks; halves on the RPC's limit errors. */
  windowBlocks?: bigint;
  onWindow?: (info: { collection: Collection; fromBlock: bigint; toBlock: bigint; logs: number }) => void;
}

async function transferRecipients(client: NestClient, collection: Collection, owner: Address, from: bigint, to: bigint, options: DiscoverOptions): Promise<Set<bigint>> {
  const address = collectionAddress(collection);
  const ids = new Set<bigint>();
  let window = options.windowBlocks ?? DEFAULT_LOG_WINDOW;
  if (window > MAX_LOG_WINDOW) window = MAX_LOG_WINDOW;
  let cursor = from;
  while (cursor <= to) {
    const end = cursor + window - 1n > to ? to : cursor + window - 1n;
    try {
      const logs = await withRetry(() =>
        client.getLogs({ address, event: ERC721_TRANSFER, args: { to: owner }, fromBlock: cursor, toBlock: end, strict: true }),
      );
      for (const log of logs) ids.add(log.args.tokenId);
      options.onWindow?.({ collection, fromBlock: cursor, toBlock: end, logs: logs.length });
      cursor = end + 1n;
      if (window < MAX_LOG_WINDOW) window = window * 2n > MAX_LOG_WINDOW ? MAX_LOG_WINDOW : window * 2n;
    } catch (error) {
      if (!isLogLimitError(error) || window <= MIN_LOG_WINDOW) throw error;
      window /= 2n;
    }
  }
  return ids;
}

/** Keeps the candidates whose current owner is `owner` (and generation >= 1 for Generations). */
async function verifyOwnership(client: NestClient, collection: Collection, owner: Address, candidates: bigint[]): Promise<bigint[]> {
  const address = collectionAddress(collection);
  const abi = collection === "Generations" ? GENERATIONS_ABI : GENESIS_ABI;
  const owned: bigint[] = [];
  for (let i = 0; i < candidates.length; i += FRIENDS_PER_BATCH) {
    const chunk = candidates.slice(i, i + FRIENDS_PER_BATCH);
    const contracts: ContractFunctionParameters[] = chunk.map((id) => ({ address, abi, functionName: "ownerOf", args: [id] }));
    if (collection === "Generations") {
      for (const id of chunk) contracts.push({ address, abi: GENERATIONS_ABI, functionName: "generation", args: [id] });
    }
    const results = await multicall(client, contracts);
    chunk.forEach((id, j) => {
      const ownerResult = results[j];
      if (ownerResult === undefined || ownerResult.status === "failure") return;
      if (!isAddressEqual(asAddress(ownerResult.result, "ownerOf"), owner)) return;
      if (collection === "Generations") {
        const genResult = results[chunk.length + j];
        if (genResult === undefined || genResult.status === "failure" || asNumber(genResult.result, "generation") < 1) return;
      }
      owned.push(id);
    });
  }
  return owned.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Finds the Friends `owner` holds without enumerating token ids: ERC-721 Transfer logs
 * with `to = owner` on both collections, paged in windows that respect the RPC's
 * 10,000-log and 10,000,000-block limits, then verified with `ownerOf`.
 */
export async function discoverOwnedFriends(
  client: NestClient,
  owner: Address,
  options: DiscoverOptions = {},
): Promise<{ generations: bigint[]; genesis: bigint[]; toBlock: bigint }> {
  const toBlock = options.toBlock ?? (await withRetry(() => client.getBlockNumber({ cacheTime: 0 })));
  const fromBlock = options.fromBlock ?? DISCOVERY_START_BLOCK;
  const genCandidates = await transferRecipients(client, "Generations", owner, fromBlock, toBlock, options);
  const genesisCandidates = await transferRecipients(client, "Genesis", owner, fromBlock, toBlock, options);
  const generations = await verifyOwnership(client, "Generations", owner, [...genCandidates]);
  const genesis = await verifyOwnership(client, "Genesis", owner, [...genesisCandidates]);
  return { generations, genesis, toBlock };
}

export interface HouseholdOptions extends DiscoverOptions {
  /** Skip discovery and read exactly these Friends (cache hit). */
  friends?: FriendRef[];
}

/** Every Friend the owner holds, the egg (temporary Friend) and the owner's RF balance and allowance. */
export async function readHousehold(client: NestClient, owner: Address, options: HouseholdOptions = {}): Promise<Household> {
  let refs = options.friends;
  if (refs === undefined) {
    const found = await discoverOwnedFriends(client, owner, options);
    refs = [
      ...found.generations.map((tokenId): FriendRef => ({ collection: "Generations", tokenId })),
      ...found.genesis.map((tokenId): FriendRef => ({ collection: "Genesis", tokenId })),
    ];
  }
  const friends = await readFriends(client, refs);
  const r = await multicall(
    client,
    [
      { address: ADDRESSES.generations, abi: GENERATIONS_ABI, functionName: "temporaryFriend", args: [owner] },
      { address: ADDRESSES.rf, abi: ERC20_ABI, functionName: "balanceOf", args: [owner] },
      { address: ADDRESSES.rf, abi: ERC20_ABI, functionName: "allowance", args: [owner, AM] },
    ],
    { allowFailure: false },
  );
  const egg = asBigint(success(r[0], "temporaryFriend"), "temporaryFriend");
  return {
    owner,
    friends,
    eggTokenId: egg === 0n ? null : egg,
    rfBalance: asBigint(success(r[1], "balanceOf"), "rfBalance"),
    rfAllowance: asBigint(success(r[2], "allowance"), "rfAllowance"),
  };
}
