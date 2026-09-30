/** Shared domain types. All amounts are bigint wei unless the name ends in Rf (number, RF units). */
import type { Address, Hex } from "viem";
import type { ActionName, FamilyName } from "./protocol/constants.js";

export type Collection = "Generations" | "Genesis";

export interface FriendIdentity {
  collection: Collection;
  tokenId: bigint;
  owner: Address;
  wallet: Address; // ERC-6551 token-bound account
  /** 1..6 for Generations, 0 for Genesis. */
  generation: number;
  family?: number;
  /** Registry family for Generations; "Genesis" for Genesis Friends (no registry family). */
  familyName?: FamilyName | "Genesis";
  /** Registry seed for Generations (seedOf(id) == id today); the token id for Genesis. */
  seed?: number;
}

export interface FriendPosition {
  tier: number; // 0..4
  weight: bigint; // wei-scaled weight; > 0 means active
  active: boolean;
}

export interface FriendRewards {
  earnedRf: bigint;
  earnedWeth: bigint;
}

export interface WalletHoldings {
  rf: bigint;
  weth: bigint;
  eth: bigint;
}

export interface Friend extends FriendIdentity {
  position: FriendPosition;
  rewards: FriendRewards;
  savings: WalletHoldings;
}

export interface StreamState {
  amount: bigint; // RF or WETH wei streamed over the current period
  periodFinish: number; // unix seconds
  lastUpdate: number;
}

export interface ProtocolState {
  blockNumber: bigint;
  timestamp: number;
  totalWeight: bigint;
  rfStream: StreamState;
  wethStream: StreamState;
  rfTotalSupply: bigint;
}

export interface Household {
  owner: Address;
  friends: Friend[];
  /** Id of the owner's temporary (generation 0) Friend, if any: the egg. */
  eggTokenId: bigint | null;
  rfBalance: bigint;
  rfAllowance: bigint; // allowance to ActivationManager
}

/** Vitals are numbers in [0, 1] plus a few discrete facts, all derived from chain state. */
export interface Vitals {
  hunger: number; // 0 = just fed, 1 = a full week or more of rewards unclaimed
  strength: number; // tier / 4
  territory: number; // (7 - generation) / 6 for Generations, 1 for Genesis
  mood: number; // share of stream relative to a reference weight, squashed
  savings: number; // log-scaled savings
  awake: boolean;
  weeklyRfFromStream: number; // RF this Friend earns per week at the current stream
  streamShare: number; // weight / totalWeight
}

export type MoodState = "content" | "hungry" | "restless" | "proud" | "sleepy" | "thrifty" | "asleep";

export interface Personality {
  name: string;
  family: FamilyName | "Genesis";
  temperament: string; // one line
  favouriteHour: number; // 0..23 UTC
  secretHabit: string;
  /** Hunger level (0..1) at which the family starts to show it. */
  hungerThreshold: number;
  /** Registry seed the name and habits were derived from (personality/describe). */
  seed?: number;
}

export interface PetFrame {
  /** 16x16 bitmap, row-major, bit (y*16+x) set = pixel on. */
  bits: bigint;
}

export interface Sprite {
  frames: PetFrame[]; // 64
  idle: PetFrame[]; // frames 0..31
  walk: PetFrame[]; // frames 32..63
}

export type StewardActionKind = "claim" | "hatch" | "raise" | "train" | "wake" | "save" | "withdraw";

export interface StewardAction {
  kind: StewardActionKind;
  friend?: Friend; // undefined for hatch
  label: string;
  costRf: number;
  burnRf: number;
  toRewardsRf: number;
  deltaWeight: number; // RF-units weight
  weeklyRfGain: number;
  breakEvenWeeks: number | null; // null when gain is 0 (e.g. claim, hatch of a tiny pup rounds to 0)
  /** Transactions in order: optional approve, then the action. */
  txs: PreparedTx[];
  rationale: string;
  /** For hatch: the generation the protocol will assign, selected by the wallet's RF balance. */
  hatchGeneration?: number;
  /**
   * For claim: true when the unclaimed rewards are below the gas-worthiness thresholds
   * (planner NEGLIGIBLE_CLAIM_RF / NEGLIGIBLE_CLAIM_WETH). Negligible claims sort last.
   */
  negligible?: boolean;
}

export interface PreparedTx {
  to: Address;
  data: Hex;
  value: bigint;
  description: string;
}

export interface DryRunResult {
  ok: boolean;
  gas?: bigint;
  revertSelector?: Hex;
  revertReason?: string;
}

export interface BurnRecord {
  txHash: Hex;
  blockNumber: bigint;
  timestamp: number;
  from: Address; // transaction sender (the household)
  action: ActionName | "unknown";
  burnedRf: bigint;
}

export interface HouseholdRank {
  owner: Address;
  burnedRf: number;
  actions: number;
  lastActionAt: number;
  /** RF burned through transactions carrying the Nest calldata tag 0x4e4553540001; absent in older snapshots. */
  viaNestRf?: number;
}

export interface Snapshot {
  blockNumber: number;
  timestamp: number;
  totals: {
    burnedRf: number;
    burnEvents: number;
    byAction: Record<string, { count: number; burnedRf: number }>;
    /** Burns whose transaction calldata ends with the Nest tag 0x4e4553540001; absent in older snapshots. */
    viaNest?: { burnEvents: number; burnedRf: number };
  };
  daily: { day: string; burnedRf: number; events: number }[];
  leaderboard: HouseholdRank[];
  hardwired: {
    total: number;
    byGeneration: Record<string, number>;
    wallets: number;
    firstBlock: number;
    /** Highest Generations id seen hardwired (any higher id was never minted); absent in older snapshots. */
    maxTokenId?: number;
  };
  genesis: { activated: number; inactive: number; reserveHeld: number };
  /** Block range the burn attribution actually covers (indexer); absent in snapshots written before it existed. */
  coverage?: { fromBlock: number; toBlock: number; complete: boolean; partial: boolean };
}
