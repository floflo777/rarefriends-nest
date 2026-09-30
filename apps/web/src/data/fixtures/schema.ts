/**
 * Shape of `demo.json`, the baked demo household: real Robinhood Chain reads written by
 * `apps/web/scripts/bake-demo.ts`. Every bigint is a decimal string, every address is
 * checksummed as the chain returned it. `mock.ts` turns this back into core types.
 */
import type { Address } from "viem";
import type { Collection, Snapshot } from "@nest/core";

export interface FixtureFriend {
  collection: Collection;
  tokenId: string;
  /** The real owner: the household owner for its own Friends, another wallet for the extra pets. */
  owner: Address;
  wallet: Address;
  generation: number;
  family?: number;
  familyName?: string;
  seed?: number;
  position: { tier: number; weight: string; active: boolean };
  rewards: { earnedRf: string; earnedWeth: string };
  savings: { rf: string; weth: string; eth: string };
  /** Key into `sprites`. */
  sprite: string;
  /** True for Friends that are not owned by the demo household owner (shown as extra pets). */
  extra: boolean;
}

export interface FixtureSprite {
  /** `frames(family, seed)` (64 words) for Generations, `portrait(family, seed)` (1 word) for Genesis. */
  kind: "frames" | "portrait";
  /** Registry arguments the words were read with. */
  family: number;
  seed: number;
  /** uint256 words as 0x-prefixed hex. */
  words: string[];
}

export interface FixtureStream {
  amount: string;
  periodFinish: number;
  lastUpdate: number;
}

export interface FixtureProtocol {
  timestamp: number;
  totalWeight: string;
  rfStream: FixtureStream;
  wethStream: FixtureStream;
  rfTotalSupply: string;
}

/** The indexer snapshot at bake time (a copy, never invented); null when none was built. */
export interface FixtureCensus extends Snapshot {
  source: string;
}

export interface DemoFixture {
  /** ISO timestamp of the bake. */
  bakedAt: string;
  /** Block the protocol state was read at. */
  blockNumber: string;
  owner: Address;
  household: { eggTokenId: string | null; rfBalance: string; rfAllowance: string };
  friends: FixtureFriend[];
  sprites: Record<string, FixtureSprite>;
  protocol: FixtureProtocol;
  census: FixtureCensus | null;
}
