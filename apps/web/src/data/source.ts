/**
 * The single seam between the UI and the chain. Components never touch viem: they
 * ask a `NestDataSource`. Two implementations exist: `mock.ts` (demo, tests) and
 * `live.ts` (real reads through @nest/core). Swapping is done at the route level
 * through `DataSourceProvider` (see context.tsx).
 */
import type { Address } from "viem";
import type { Collection, Friend, Household, ProtocolState, Snapshot, Sprite } from "@nest/core";

export type SourceErrorCode = "egg" | "not-found" | "unavailable";

/** A typed failure the LCD can phrase: an unhatched egg, a missing token, or data not there yet. */
export class SourceError extends Error {
  override readonly name = "SourceError";
  constructor(
    readonly code: SourceErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface NestDataSource {
  /** Stream, total weight, RF supply at the latest block. */
  protocolState(): Promise<ProtocolState>;
  /** One Friend with position, rewards and savings. Throws SourceError("egg" | "not-found"). */
  friend(collection: Collection, tokenId: bigint): Promise<Friend>;
  /** Every Friend the owner holds plus the owner's egg, RF balance and allowance. */
  household(owner: Address): Promise<Household>;
  /** Indexer output (leaderboard, burn totals, census). Throws SourceError("unavailable") until built. */
  snapshot(): Promise<Snapshot>;
  /** The Friend's 64 on-chain frames (idle 0..31, walk 32..63). */
  sprite(friend: Friend): Promise<Sprite>;
}

/** URL slug <-> core collection name. */
export type CollectionSlug = "gen" | "genesis";

export function collectionFromSlug(slug: string | undefined): Collection | null {
  if (slug === "gen") return "Generations";
  if (slug === "genesis") return "Genesis";
  return null;
}

export function slugOfCollection(collection: Collection): CollectionSlug {
  return collection === "Generations" ? "gen" : "genesis";
}

export function parseTokenId(raw: string | undefined): bigint | null {
  if (!raw || !/^\d{1,12}$/.test(raw)) return null;
  return BigInt(raw);
}

export function friendKey(collection: Collection, tokenId: bigint): string {
  return `${slugOfCollection(collection)}:${tokenId.toString()}`;
}

export function sameFriend(a: Pick<Friend, "collection" | "tokenId">, b: Pick<Friend, "collection" | "tokenId">): boolean {
  return a.collection === b.collection && a.tokenId === b.tokenId;
}
