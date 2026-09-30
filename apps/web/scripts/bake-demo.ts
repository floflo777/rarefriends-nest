/**
 * Bakes the demo household from the public RPC into `src/data/fixtures/demo.json`, so the
 * demo shows real Friends (identity, position, rewards, savings, registry frames) offline.
 *
 *   npx tsx apps/web/scripts/bake-demo.ts            # from the repository root
 *   NEST_RPC_URL=https://... npx tsx apps/web/scripts/bake-demo.ts
 *
 * Read-only: every call is a view; nothing is signed or sent. The transport keeps at most
 * MAX_IN_FLIGHT requests open and retries HTTP 429 with core's back-off.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { http, isAddressEqual, type Address, type Transport } from "viem";
import {
  ADDRESSES,
  FAMILIES_REGISTRY_ABI,
  FRAME_COUNT,
  RPC_URL,
  createNestClient,
  readFriends,
  readHousehold,
  readProtocolState,
  withRetry,
  type Friend,
  type FriendRef,
  type NestClient,
  type Snapshot,
} from "@nest/core";
import type { DemoFixture, FixtureCensus, FixtureFriend, FixtureSprite } from "../src/data/fixtures/schema.js";

/** The demo household: a real wallet with two hardwired Friends and an egg. */
export const DEMO_HOUSEHOLD_OWNER: Address = "0x3d35a856cb96f9770c986841f4fdb7e198a272cb";
/** Extra pets shown next to the household, with their real owners. */
export const EXTRA_PETS: readonly (FriendRef & { expectedOwner?: Address })[] = [
  { collection: "Generations", tokenId: 1969n, expectedOwner: "0x30Df16cd7D612C5B25bEb0331486b127a42Ac371" },
  { collection: "Genesis", tokenId: 597n },
];
export const MAX_IN_FLIGHT = 20;
/** Leaderboard rows kept from the indexer snapshot (the RANK screen shows six plus the household). */
const LEADERBOARD_ROWS = 12;

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../src/data/fixtures/demo.json");
const SNAPSHOT = resolve(here, "../public/data/snapshot.json");

/** Limits the number of concurrently running promises. */
function semaphore(limit: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: (() => void)[] = [];
  const release = (): void => {
    active -= 1;
    queue.shift()?.();
  };
  return async (fn) => {
    if (active >= limit) await new Promise<void>((wake) => queue.push(wake));
    active += 1;
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

/** viem http transport wrapped in an in-flight cap and a 429 back-off. */
function throttledTransport(url: string): Transport {
  const limit = semaphore(MAX_IN_FLIGHT);
  const base = http(url, { batch: { batchSize: MAX_IN_FLIGHT, wait: 16 }, retryCount: 0, timeout: 30_000 });
  return (options) => {
    const inner = base(options);
    const request = ((args: Parameters<typeof inner.request>[0]) =>
      limit(() =>
        withRetry(() => inner.request(args), {
          retries: 6,
          onRetry: (_e, attempt, delay) => log(`429, retry ${attempt} in ${Math.round(delay)} ms`),
        }),
      )) as typeof inner.request;
    return { ...inner, request };
  };
}

function log(line: string): void {
  process.stderr.write(`${line}\n`);
}

const hex = (word: bigint): string => `0x${word.toString(16)}`;

function spriteKey(f: Friend, registry: { family: number; seed: number }): string {
  return `${f.collection === "Genesis" ? "portrait" : "frames"}:${registry.family}:${registry.seed}`;
}

/** familyOf / seedOf from the registry; Generations Friends already carry them. */
async function registryOf(client: NestClient, f: Friend): Promise<{ family: number; seed: number }> {
  if (f.collection === "Generations" && f.family !== undefined && f.seed !== undefined) return { family: f.family, seed: f.seed };
  const [family, seed] = await withRetry(() =>
    client.multicall({
      contracts: [
        { address: ADDRESSES.familiesRegistry, abi: FAMILIES_REGISTRY_ABI, functionName: "familyOf", args: [f.tokenId] },
        { address: ADDRESSES.familiesRegistry, abi: FAMILIES_REGISTRY_ABI, functionName: "seedOf", args: [f.tokenId] },
      ],
      allowFailure: false,
    }),
  );
  return { family: Number(family), seed: Number(seed) };
}

async function readSprite(client: NestClient, f: Friend, registry: { family: number; seed: number }): Promise<FixtureSprite> {
  if (f.collection === "Generations") {
    const words = await withRetry(() =>
      client.readContract({ address: ADDRESSES.familiesRegistry, abi: FAMILIES_REGISTRY_ABI, functionName: "frames", args: [registry.family, registry.seed] }),
    );
    if (words.length !== FRAME_COUNT) throw new Error(`frames(${registry.family}, ${registry.seed}) returned ${words.length} words`);
    return { kind: "frames", ...registry, words: words.map(hex) };
  }
  const word = await withRetry(() =>
    client.readContract({ address: ADDRESSES.familiesRegistry, abi: FAMILIES_REGISTRY_ABI, functionName: "portrait", args: [registry.family, registry.seed] }),
  );
  return { kind: "portrait", ...registry, words: [hex(word)] };
}

function toFixtureFriend(f: Friend, sprite: string, extra: boolean): FixtureFriend {
  const out: FixtureFriend = {
    collection: f.collection,
    tokenId: f.tokenId.toString(),
    owner: f.owner,
    wallet: f.wallet,
    generation: f.generation,
    position: { tier: f.position.tier, weight: f.position.weight.toString(), active: f.position.active },
    rewards: { earnedRf: f.rewards.earnedRf.toString(), earnedWeth: f.rewards.earnedWeth.toString() },
    savings: { rf: f.savings.rf.toString(), weth: f.savings.weth.toString(), eth: f.savings.eth.toString() },
    sprite,
    extra,
  };
  if (f.family !== undefined) out.family = f.family;
  if (f.familyName !== undefined) out.familyName = f.familyName;
  if (f.seed !== undefined) out.seed = f.seed;
  return out;
}

/** A copy of the indexer snapshot next to the app, trimmed to what the LCD shows. Never invented. */
function censusFrom(path: string, owners: Address[]): FixtureCensus | null {
  if (!existsSync(path)) return null;
  const s = JSON.parse(readFileSync(path, "utf8")) as Snapshot;
  const board = [...s.leaderboard].sort((a, b) => b.burnedRf - a.burnedRf);
  const kept = board.filter((r, i) => i < LEADERBOARD_ROWS || owners.some((o) => isAddressEqual(o, r.owner)));
  return {
    source: `public/data/snapshot.json @ block ${s.blockNumber}`,
    blockNumber: s.blockNumber,
    timestamp: s.timestamp,
    totals: s.totals,
    daily: s.daily.slice(-7),
    leaderboard: kept,
    hardwired: s.hardwired,
    genesis: s.genesis,
  };
}

async function main(): Promise<void> {
  const url = process.env["NEST_RPC_URL"] ?? RPC_URL;
  const client = createNestClient({ transport: throttledTransport(url) });
  log(`RPC ${url}`);

  const protocol = await readProtocolState(client);
  log(`block ${protocol.blockNumber}, totalWeight ${protocol.totalWeight}`);

  const household = await readHousehold(client, DEMO_HOUSEHOLD_OWNER, {
    onWindow: (w) => log(`  ${w.collection} logs ${w.fromBlock}-${w.toBlock}: ${w.logs}`),
  });
  log(`household ${DEMO_HOUSEHOLD_OWNER}: ${household.friends.map((f) => `${f.collection} #${f.tokenId}`).join(", ") || "no Friend"}, egg ${household.eggTokenId ?? "none"}`);

  const extras = await readFriends(client, EXTRA_PETS);
  for (const pet of EXTRA_PETS) {
    const f = extras.find((x) => x.collection === pet.collection && x.tokenId === pet.tokenId);
    if (!f) throw new Error(`${pet.collection} #${pet.tokenId} was not read`);
    if (pet.expectedOwner && !isAddressEqual(f.owner, pet.expectedOwner)) log(`warning: ${pet.collection} #${pet.tokenId} is owned by ${f.owner}, expected ${pet.expectedOwner}`);
  }

  // Order: the Gen-1 showcase first, then the household's own Friends by id, then the other extras.
  const own = [...household.friends].sort((a, b) => (a.tokenId < b.tokenId ? -1 : 1));
  const [showcase, ...otherExtras] = extras;
  const ordered: { friend: Friend; extra: boolean }[] = [
    ...(showcase ? [{ friend: showcase, extra: true }] : []),
    ...own.map((friend) => ({ friend, extra: false })),
    ...otherExtras.map((friend) => ({ friend, extra: true })),
  ];

  const sprites: Record<string, FixtureSprite> = {};
  const friends: FixtureFriend[] = [];
  for (const { friend, extra } of ordered) {
    const registry = await registryOf(client, friend);
    const key = spriteKey(friend, registry);
    if (!sprites[key]) {
      sprites[key] = await readSprite(client, friend, registry);
      log(`sprite ${key}: ${sprites[key].words.length} word(s)`);
    }
    friends.push(toFixtureFriend(friend, key, extra));
  }

  const fixture: DemoFixture = {
    bakedAt: new Date().toISOString(),
    blockNumber: protocol.blockNumber.toString(),
    owner: DEMO_HOUSEHOLD_OWNER,
    household: {
      eggTokenId: household.eggTokenId === null ? null : household.eggTokenId.toString(),
      rfBalance: household.rfBalance.toString(),
      rfAllowance: household.rfAllowance.toString(),
    },
    friends,
    sprites,
    protocol: {
      timestamp: protocol.timestamp,
      totalWeight: protocol.totalWeight.toString(),
      rfStream: { amount: protocol.rfStream.amount.toString(), periodFinish: protocol.rfStream.periodFinish, lastUpdate: protocol.rfStream.lastUpdate },
      wethStream: { amount: protocol.wethStream.amount.toString(), periodFinish: protocol.wethStream.periodFinish, lastUpdate: protocol.wethStream.lastUpdate },
      rfTotalSupply: protocol.rfTotalSupply.toString(),
    },
    census: censusFrom(SNAPSHOT, [DEMO_HOUSEHOLD_OWNER, ...friends.map((f) => f.owner)]),
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(fixture, null, 2)}\n`);
  log(`wrote ${OUT} (${friends.length} Friends, ${Object.keys(sprites).length} sprites, census ${fixture.census ? "copied" : "absent"})`);
}

main().catch((error: unknown) => {
  log(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});
