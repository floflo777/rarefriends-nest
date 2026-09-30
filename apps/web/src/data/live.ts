/**
 * Live data source: real Robinhood Chain reads through @nest/core, plus the indexer
 * snapshot served next to the app. The public RPC rate-limits (HTTP 429), so every read
 * is memoised for about one block (12 s), in-flight calls are shared, sprites are cached
 * for good (registry frames never change) and household discovery is incremental from
 * the last block it saw. Nothing here signs or sends anything.
 */
import { isAddressEqual } from "viem";
import type { Address } from "viem";
import {
  ADDRESSES,
  FAMILIES_REGISTRY_ABI,
  FAMILY_NAMES,
  FRAME_COUNT,
  FriendReadError,
  PORTRAIT_SIZE,
  TemporaryFriendError,
  decodeFrames,
  decodePortrait8,
  discoverOwnedFriends,
  readFriend,
  readHousehold,
  readProtocolState,
  rowsToFrame,
  type Collection,
  type Friend,
  type FriendRef,
  type Household,
  type NestClient,
  type PetFrame,
  type ProtocolState,
  type Snapshot,
  type Sprite,
} from "@nest/core";
import { cachedScene, readTokenMetadata, type TokenScene } from "../model/scene.js";
import { maxHardwiredId } from "../model/snapshot.js";
import { SourceError, friendKey, type NestDataSource } from "./source.js";

/** Reads are reused for one block. */
export const CACHE_TTL_MS = 12_000;
/** The device never asks the chain more often than this (the RPC answers 429 above ~100 calls/s). */
export const MIN_POLL_MS = 15_000;
const SNAPSHOT_TTL_MS = 60_000;

export const EGG_MESSAGE = "EGG: not hatched yet";

export function snapshotUrl(): string {
  return `${import.meta.env.BASE_URL}data/snapshot.json`;
}

/** Time-bounded memo that also shares an in-flight promise between concurrent callers. */
class Memo {
  private readonly entries = new Map<string, { at: number; value: Promise<unknown> }>();

  get<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.entries.get(key);
    if (hit && now - hit.at < ttlMs) return hit.value as Promise<T>;
    const value = load();
    this.entries.set(key, { at: now, value });
    value.catch(() => this.entries.delete(key));
    return value;
  }

  invalidate(prefix: string): void {
    for (const key of this.entries.keys()) if (key.startsWith(prefix)) this.entries.delete(key);
  }
}

function storageGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage is a cache, never required.
  }
}

/** Generic 8x8 portrait used when a Genesis portrait cannot be read. */
const GENERIC_PORTRAIT: readonly boolean[][] = ["..####..", ".#....#.", "#.#..#.#", "#......#", "#.#..#.#", "#..##..#", ".#....#.", "..####.."].map((r) =>
  Array.from(r, (c) => c === "#"),
);

/** An 8x8 portrait as a 16x16 frame (each pixel doubled), so Genesis shares the pet renderer. */
export function portraitToFrame(rows: readonly (readonly boolean[])[]): PetFrame {
  const out: boolean[][] = [];
  for (let y = 0; y < PORTRAIT_SIZE * 2; y++) {
    const src = rows[Math.floor(y / 2)] ?? [];
    const row: boolean[] = [];
    for (let x = 0; x < PORTRAIT_SIZE * 2; x++) row.push(src[Math.floor(x / 2)] ?? false);
    out.push(row);
  }
  return rowsToFrame(out);
}

/** A still sprite: the same frame in every slot of both clips. */
export function stillSprite(frame: PetFrame): Sprite {
  const frames = Array.from({ length: FRAME_COUNT }, () => frame);
  return { frames, idle: frames.slice(0, FRAME_COUNT / 2), walk: frames.slice(FRAME_COUNT / 2) };
}

interface StoredRefs {
  refs: { collection: Collection; tokenId: string }[];
  toBlock: string;
}

interface Registry {
  family: number;
  seed: number;
}

export interface LiveSource extends NestDataSource {
  readonly client: NestClient;
  /** Forget memoised reads for an owner (after a transaction lands). */
  invalidateHousehold(owner: Address): void;
}

export function createLiveSource(client: NestClient): LiveSource {
  const memo = new Memo();
  const registry = new Map<string, Promise<Registry | null>>();
  const sprites = new Map<string, Promise<Sprite>>();
  const discovered = new Map<string, { refs: FriendRef[]; toBlock: bigint }>();

  const registryFor = (tokenId: bigint): Promise<Registry | null> => {
    const key = tokenId.toString();
    let p = registry.get(key);
    if (!p) {
      p = client
        .multicall({
          contracts: [
            { address: ADDRESSES.familiesRegistry, abi: FAMILIES_REGISTRY_ABI, functionName: "familyOf", args: [tokenId] },
            { address: ADDRESSES.familiesRegistry, abi: FAMILIES_REGISTRY_ABI, functionName: "seedOf", args: [tokenId] },
          ],
          allowFailure: false,
        })
        .then(([family, seed]) => ({ family: Number(family), seed: Number(seed) }))
        .catch(() => null);
      registry.set(key, p);
    }
    return p;
  };

  /**
   * Genesis identities carry no family/seed from the collection; the registry answers for
   * any id (it selects the portrait), but a Genesis Friend has no Generations family: its
   * familyName is "Genesis", as the CLI prints it.
   */
  const withRegistry = async (friend: Friend): Promise<Friend> => {
    if (friend.collection === "Genesis" && friend.familyName !== "Genesis") friend = { ...friend, familyName: "Genesis" };
    if (friend.family !== undefined && friend.seed !== undefined) return friend;
    const r = await registryFor(friend.tokenId);
    if (!r) return friend;
    const enriched: Friend = { ...friend, family: r.family, seed: r.seed };
    if (friend.collection === "Generations") {
      const name = FAMILY_NAMES[r.family];
      if (name !== undefined) enriched.familyName = name;
    }
    return enriched;
  };

  const loadSnapshot = (): Promise<Snapshot> =>
    memo.get("snapshot", SNAPSHOT_TTL_MS, async () => {
      const res = await fetch(snapshotUrl(), { cache: "no-cache" });
      if (!res.ok) throw new SourceError("unavailable", `snapshot not built yet (HTTP ${res.status})`);
      let parsed: unknown;
      try {
        parsed = await res.json();
      } catch {
        // The SPA fallback answers index.html for a missing file.
        throw new SourceError("unavailable", "snapshot not built yet");
      }
      if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as Snapshot).leaderboard) || typeof (parsed as Snapshot).totals !== "object") {
        throw new SourceError("unavailable", "snapshot has an unexpected shape");
      }
      return parsed as Snapshot;
    });

  /**
   * The chain answers generation 0 for an unhatched egg and for an id that was never
   * minted alike. Above the census' highest hardwired id it is the latter.
   */
  const eggOrMissing = async (tokenId: bigint): Promise<SourceError> => {
    const max = await loadSnapshot().then(maxHardwiredId, () => null);
    if (max !== null && tokenId > max) return new SourceError("not-found", `Generations #${tokenId} was never minted (highest hardwired id #${max})`);
    return new SourceError("egg", EGG_MESSAGE);
  };

  const loadRefs = (owner: Address): { refs: FriendRef[]; toBlock: bigint } | null => {
    const hit = discovered.get(owner.toLowerCase());
    if (hit) return hit;
    const stored = storageGet<StoredRefs>(`nest.friends.${owner.toLowerCase()}`);
    if (!stored) return null;
    const refs = stored.refs.map((r): FriendRef => ({ collection: r.collection, tokenId: BigInt(r.tokenId) }));
    return { refs, toBlock: BigInt(stored.toBlock) };
  };

  const saveRefs = (owner: Address, refs: FriendRef[], toBlock: bigint): void => {
    discovered.set(owner.toLowerCase(), { refs, toBlock });
    const stored: StoredRefs = { refs: refs.map((r) => ({ collection: r.collection, tokenId: r.tokenId.toString() })), toBlock: toBlock.toString() };
    storageSet(`nest.friends.${owner.toLowerCase()}`, stored);
  };

  const readHouseholdIncremental = async (owner: Address): Promise<Household> => {
    const cached = loadRefs(owner);
    const found = await discoverOwnedFriends(client, owner, cached ? { fromBlock: cached.toBlock + 1n } : {});
    const refs = new Map<string, FriendRef>();
    for (const r of cached?.refs ?? []) refs.set(`${r.collection}:${r.tokenId}`, r);
    for (const tokenId of found.generations) refs.set(`Generations:${tokenId}`, { collection: "Generations", tokenId });
    for (const tokenId of found.genesis) refs.set(`Genesis:${tokenId}`, { collection: "Genesis", tokenId });
    const household = await readHousehold(client, owner, { friends: [...refs.values()] });
    // A cached Friend may have been sold since: keep only what the owner still holds.
    const friends = await Promise.all(household.friends.filter((f) => isAddressEqual(f.owner, owner)).map(withRegistry));
    saveRefs(
      owner,
      friends.map((f) => ({ collection: f.collection, tokenId: f.tokenId })),
      found.toBlock,
    );
    return { ...household, friends };
  };

  const spriteFor = (collection: Collection, family: number, seed: number): Promise<Sprite> => {
    const key = `${collection}:${family}:${seed}`;
    let p = sprites.get(key);
    if (p) return p;
    const storageKey = `nest.sprite.${key}`;
    p = (async () => {
      const stored = storageGet<string[]>(storageKey);
      if (stored && stored.length === FRAME_COUNT) return decodeFrames(stored.map((w) => BigInt(w)));
      if (collection === "Generations") {
        const words = await client.readContract({ address: ADDRESSES.familiesRegistry, abi: FAMILIES_REGISTRY_ABI, functionName: "frames", args: [family, seed] });
        const sprite = decodeFrames(words as readonly bigint[]);
        storageSet(
          storageKey,
          sprite.frames.map((f) => `0x${f.bits.toString(16)}`),
        );
        return sprite;
      }
      // Genesis: one 8x8 portrait, best effort.
      try {
        const word = await client.readContract({ address: ADDRESSES.familiesRegistry, abi: FAMILIES_REGISTRY_ABI, functionName: "portrait", args: [family, seed] });
        const sprite = stillSprite(portraitToFrame(decodePortrait8(word)));
        storageSet(
          storageKey,
          sprite.frames.map((f) => `0x${f.bits.toString(16)}`),
        );
        return sprite;
      } catch {
        return stillSprite(portraitToFrame(GENERIC_PORTRAIT));
      }
    })();
    p.catch(() => sprites.delete(key));
    sprites.set(key, p);
    return p;
  };

  return {
    client,

    protocolState(): Promise<ProtocolState> {
      return memo.get("protocol", CACHE_TTL_MS, () => readProtocolState(client));
    },

    friend(collection, tokenId): Promise<Friend> {
      return memo.get(`friend:${collection}:${tokenId}`, CACHE_TTL_MS, async () => {
        try {
          return await withRegistry(await readFriend(client, collection, tokenId));
        } catch (error) {
          if (error instanceof TemporaryFriendError) throw await eggOrMissing(tokenId);
          if (error instanceof FriendReadError) throw new SourceError("not-found", `${collection} #${tokenId} does not exist`);
          throw error;
        }
      });
    },

    household(owner): Promise<Household> {
      return memo.get(`household:${owner.toLowerCase()}`, CACHE_TTL_MS, () => readHouseholdIncremental(owner));
    },

    snapshot(): Promise<Snapshot> {
      return loadSnapshot();
    },

    async sprite(friend): Promise<Sprite> {
      const enriched = await withRegistry(friend);
      if (enriched.family === undefined || enriched.seed === undefined) {
        return stillSprite(portraitToFrame(GENERIC_PORTRAIT));
      }
      return spriteFor(enriched.collection, enriched.family, enriched.seed);
    },

    scene(friend): Promise<TokenScene> {
      return cachedScene(friendKey(friend.collection, friend.tokenId), () => readTokenMetadata(client, friend.collection, friend.tokenId));
    },

    invalidateHousehold(owner) {
      memo.invalidate(`household:${owner.toLowerCase()}`);
      memo.invalidate("friend:");
      memo.invalidate("protocol");
    },
  };
}
