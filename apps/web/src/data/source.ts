/**
 * The single seam between the UI and the chain. Components never touch viem: they
 * ask a `NestDataSource`. Two implementations exist: `mock.ts` (demo, tests) and
 * `live.ts` (real reads, to be wired to packages/core). Swapping is done at the
 * route level through `DataSourceProvider` (see context.tsx).
 */
import type { Address } from "viem";
import type { Collection, Friend, Household, PetFrame, ProtocolState, Snapshot } from "@nest/core";

export interface NestDataSource {
  /** Stream, total weight, RF supply at the latest block. */
  protocolState(): Promise<ProtocolState>;
  /** One Friend with position, rewards and savings; null when the token does not exist. */
  friend(collection: Collection, tokenId: bigint): Promise<Friend | null>;
  /** Every Friend the owner holds plus the owner's egg, RF balance and allowance. */
  household(owner: Address): Promise<Household>;
  /** Indexer output (leaderboard, burn totals, census). */
  snapshot(): Promise<Snapshot>;
  /**
   * On-chain sprite frames (families registry `frames(family, seed)`, 64 x 16x16).
   * A source may return a single frame until the decoder lands.
   */
  sprite(friend: Friend): Promise<PetFrame[]>;
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
