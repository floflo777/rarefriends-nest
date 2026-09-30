/**
 * Mock data source: realistic fixtures from Robinhood Chain reads on 2026-09-30 plus a
 * synthetic demo household. `simulate()` mutates the fixtures so the demo's care
 * actions visibly change the pet; nothing here touches a wallet or the chain.
 */
import type { Address } from "viem";
import {
  DENOMINATION_RF,
  GENERATION_WEIGHT_BPS,
  GENESIS_WEIGHT,
  TIER_CUMULATIVE_BPS,
  type Collection,
  type Friend,
  type Household,
  type PetFrame,
  type ProtocolState,
  type Snapshot,
  type StewardActionKind,
} from "@nest/core";
import { frameFromRows, mirrorFrame } from "../lcd/sprite.js";
import { fromUnits } from "../model/format.js";
import type { NestDataSource } from "./source.js";

/** Friend 1969 (Generations, family Asymmetry), one of its 64 on-chain frames. */
export const FRIEND_1969_FRAME: readonly string[] = [
  "................",
  "................",
  "................",
  "................",
  "................",
  "....#......#....",
  "....########....",
  "....#..##..#....",
  "....########....",
  ".....######.#...",
  ".....##..####...",
  ".....#######....",
  ".....######.....",
  ".....##..##.....",
  ".....##..##.....",
  "................",
];

/** A generic pup silhouette for Friends whose frames are not hardcoded. */
const GENERIC_FRAME: readonly string[] = [
  "................",
  "................",
  "................",
  "......####......",
  ".....#....#.....",
  "....#.#..#.#....",
  "....#......#....",
  "....#.####.#....",
  ".....#....#.....",
  "......####......",
  ".....#....#.....",
  "....#......#....",
  "....#......#....",
  ".....#....#.....",
  "......####......",
  "................",
];

export const DEMO_OWNER: Address = "0xd3a0d3a0d3a0d3a0d3a0d3a0d3a0d3a0d3a0d3a0";
const HOUSEHOLD_RANK_BURNED_RF = 84_500;

function tba(tokenId: bigint, collection: Collection): Address {
  const tag = collection === "Genesis" ? "6e" : "9e";
  return `0x${tag}${tokenId.toString(16).padStart(38, "0")}` as Address;
}

function generationsFriend(tokenId: number, generation: number, tier: number, weight: string, extra: Partial<Friend> = {}): Friend {
  const family = tokenId % 9;
  return {
    collection: "Generations",
    tokenId: BigInt(tokenId),
    owner: DEMO_OWNER,
    wallet: tba(BigInt(tokenId), "Generations"),
    generation,
    family,
    seed: tokenId,
    position: { tier, weight: fromUnits(weight), active: true },
    rewards: { earnedRf: 0n, earnedWeth: 0n },
    savings: { rf: 0n, weth: 0n, eth: 0n },
    ...extra,
  };
}

function initialFriends(): Friend[] {
  return [
    // Real facts: Gen 1 tier 2, weight 416,250, family Asymmetry, 36,189 RF + 0.0228 WETH unclaimed.
    generationsFriend(1969, 1, 2, "416250", {
      family: 4,
      familyName: "Asymmetry",
      rewards: { earnedRf: fromUnits("36189"), earnedWeth: fromUnits("0.0228") },
      savings: { rf: fromUnits("12400"), weth: fromUnits("0.0912"), eth: fromUnits("0.004") },
    }),
    // Real facts: Gen 4 tier 1, weight 198.75. Family is a placeholder (familyOf not read yet).
    generationsFriend(343695, 4, 1, "198.75", {
      familyName: "Hoverer",
      family: 5,
      rewards: { earnedRf: fromUnits("3.2"), earnedWeth: 0n },
      savings: { rf: fromUnits("41"), weth: 0n, eth: 0n },
    }),
    // Synthetic Gen 6 pup: 1 RF hardwired, weight 1.10, never fed.
    generationsFriend(612044, 6, 0, "1.1", { familyName: "Cellular", family: 3, rewards: { earnedRf: fromUnits("0.0141"), earnedWeth: 0n } }),
    // Synthetic inactive Genesis Friend (weight 0): the Wake action.
    {
      collection: "Genesis",
      tokenId: 77n,
      owner: DEMO_OWNER,
      wallet: tba(77n, "Genesis"),
      generation: 0,
      position: { tier: 0, weight: 0n, active: false },
      rewards: { earnedRf: 0n, earnedWeth: 0n },
      savings: { rf: 0n, weth: 0n, eth: 0n },
    },
  ];
}

function initialProtocol(): ProtocolState {
  const periodFinish = Math.floor(Date.UTC(2026, 8, 30, 15, 9, 6) / 1000);
  return {
    blockNumber: 76_460_000n,
    timestamp: periodFinish - 6 * 3600,
    totalWeight: fromUnits("1068713093.63"),
    rfStream: { amount: fromUnits("8547984.3"), periodFinish, lastUpdate: periodFinish - 6 * 3600 },
    wethStream: { amount: fromUnits("1.6288"), periodFinish, lastUpdate: periodFinish - 6 * 3600 },
    rfTotalSupply: fromUnits("947740000"),
  };
}

function fakeAddress(i: number): Address {
  // Deterministic, visibly distinct synthetic addresses for the demo leaderboard.
  let h = 0x9e37_79b9 ^ (i + 1) * 0x85eb_ca6b;
  let out = "";
  for (let k = 0; k < 5; k++) {
    h = (Math.imul(h ^ (h >>> 15), 0x2c1b_3c6d) ^ (i * 0x297a_2d39)) >>> 0;
    out += h.toString(16).padStart(8, "0");
  }
  return `0x${out}` as Address;
}

function initialSnapshot(): Snapshot {
  const now = Math.floor(Date.UTC(2026, 8, 30, 9, 0, 0) / 1000);
  const others = [4_212_500, 2_900_000, 1_150_000, 640_000, 84_500, 61_000, 25_300, 9_950, 2_100, 505];
  const leaderboard = others.map((burnedRf, i) => ({
    owner: i === 4 ? DEMO_OWNER : fakeAddress(i),
    burnedRf,
    actions: Math.max(1, Math.round(burnedRf / 4000) + 3),
    lastActionAt: now - i * 5400,
  }));
  return {
    blockNumber: 76_460_000,
    timestamp: now,
    totals: {
      burnedRf: 76_260_000,
      burnEvents: 66_412,
      byAction: {
        hardwire: { count: 62_333, burnedRf: 21_400_000 },
        promote: { count: 2_811, burnedRf: 18_600_000 },
        upgrade: { count: 1_053, burnedRf: 24_260_000 },
        activate: { count: 215, burnedRf: 12_000_000 },
      },
    },
    daily: [
      { day: "2026-09-27", burnedRf: 610_000, events: 402 },
      { day: "2026-09-28", burnedRf: 522_000, events: 377 },
      { day: "2026-09-29", burnedRf: 655_000, events: 419 },
      { day: "2026-09-30", burnedRf: 375_000, events: 231 },
    ],
    leaderboard,
    hardwired: {
      total: 62_333,
      byGeneration: { "1": 522, "2": 335, "3": 1_028, "4": 4_218, "5": 15_527, "6": 40_703 },
      wallets: 3_738,
      firstBlock: 64_590_957,
    },
    genesis: { activated: 215, inactive: 809, reserveHeld: 0 },
  };
}

export interface MockSource extends NestDataSource {
  /** Apply a care action to the fixtures (demo mode). Returns a one-line description. */
  simulate(kind: StewardActionKind, target: { collection: Collection; tokenId: bigint } | null): string;
  /** Reset fixtures to their initial state (tests). */
  reset(): void;
}

export function createMockSource(): MockSource {
  let friends = initialFriends();
  let protocol = initialProtocol();
  let egg: bigint | null = 700_001n;
  let burnedByHousehold = HOUSEHOLD_RANK_BURNED_RF;
  let householdActions = 24;
  const snapshot = initialSnapshot();

  const find = (collection: Collection, tokenId: bigint) => friends.find((f) => f.collection === collection && f.tokenId === tokenId) ?? null;

  const burn = (costRf: number) => {
    burnedByHousehold += costRf / 2;
    householdActions += 1;
    protocol = { ...protocol, rfTotalSupply: protocol.rfTotalSupply - fromUnits(costRf / 2) };
    snapshot.totals = { ...snapshot.totals, burnedRf: snapshot.totals.burnedRf + costRf / 2 };
    const me = snapshot.leaderboard.find((r) => r.owner === DEMO_OWNER);
    if (me) {
      me.burnedRf = burnedByHousehold;
      me.actions = householdActions;
      snapshot.leaderboard.sort((a, b) => b.burnedRf - a.burnedRf);
    }
  };

  const addWeight = (delta: bigint) => {
    protocol = { ...protocol, totalWeight: protocol.totalWeight + delta };
  };

  return {
    async protocolState() {
      return protocol;
    },
    async friend(collection, tokenId) {
      return find(collection, tokenId);
    },
    async household(owner): Promise<Household> {
      const mine = owner.toLowerCase() === DEMO_OWNER.toLowerCase();
      return {
        owner,
        friends: mine ? friends.slice() : [],
        eggTokenId: mine ? egg : null,
        rfBalance: mine ? fromUnits("250000") : 0n,
        rfAllowance: 0n,
      };
    },
    async snapshot() {
      return { ...snapshot, leaderboard: snapshot.leaderboard.map((r) => ({ ...r })) };
    },
    async sprite(friend): Promise<PetFrame[]> {
      if (friend.collection === "Generations" && friend.tokenId === 1969n) {
        const f = frameFromRows(FRIEND_1969_FRAME);
        return [f, mirrorFrame(f)];
      }
      const f = frameFromRows(GENERIC_FRAME);
      return [f, mirrorFrame(f)];
    },
    simulate(kind, target) {
      const friend = target ? find(target.collection, target.tokenId) : null;
      const replace = (updated: Friend) => {
        friends = friends.map((f) => (f.collection === updated.collection && f.tokenId === updated.tokenId ? updated : f));
      };
      switch (kind) {
        case "claim": {
          if (!friend) return "Nothing to feed";
          replace({
            ...friend,
            rewards: { earnedRf: 0n, earnedWeth: 0n },
            savings: { ...friend.savings, rf: friend.savings.rf + friend.rewards.earnedRf, weth: friend.savings.weth + friend.rewards.earnedWeth },
          });
          return `Fed #${friend.tokenId}: rewards claimed to its wallet`;
        }
        case "train": {
          if (!friend || friend.position.tier >= TIER_CUMULATIVE_BPS.length - 1) return "Cannot train";
          const cur = TIER_CUMULATIVE_BPS[friend.position.tier] ?? 10_000;
          const next = TIER_CUMULATIVE_BPS[friend.position.tier + 1] ?? cur;
          const weight = (friend.position.weight * BigInt(next)) / BigInt(cur);
          const denom = friend.collection === "Genesis" ? 1_000_000 : (DENOMINATION_RF[friend.generation] ?? 0);
          burn((denom * (next - cur)) / 10_000);
          addWeight(weight - friend.position.weight);
          replace({ ...friend, position: { ...friend.position, tier: friend.position.tier + 1, weight } });
          return `Trained #${friend.tokenId} to tier ${friend.position.tier + 1}`;
        }
        case "raise": {
          if (!friend || friend.collection !== "Generations" || friend.generation <= 1) return "Cannot raise";
          const g = friend.generation;
          const num = BigInt((DENOMINATION_RF[g - 1] ?? 0) * (GENERATION_WEIGHT_BPS[g - 1] ?? 0));
          const den = BigInt((DENOMINATION_RF[g] ?? 1) * (GENERATION_WEIGHT_BPS[g] ?? 1));
          const weight = (friend.position.weight * num) / den;
          burn((DENOMINATION_RF[g - 1] ?? 0) - (DENOMINATION_RF[g] ?? 0));
          addWeight(weight - friend.position.weight);
          replace({ ...friend, generation: g - 1, position: { ...friend.position, weight } });
          return `Raised #${friend.tokenId} to generation ${g - 1}`;
        }
        case "wake": {
          if (!friend || friend.collection !== "Genesis" || friend.position.active) return "Already awake";
          const weight = fromUnits(GENESIS_WEIGHT);
          burn(100_000);
          addWeight(weight);
          replace({ ...friend, position: { tier: 0, weight, active: true } });
          return `Woke Genesis #${friend.tokenId}`;
        }
        case "hatch": {
          if (egg === null) return "No egg";
          const id = Number(egg);
          const gen6 = generationsFriend(id, 6, 0, "1.1", { familyName: "Skeleton", family: 0 });
          friends = [...friends, gen6];
          burn(DENOMINATION_RF[6] ?? 1);
          addWeight(gen6.position.weight);
          egg = null;
          return `Hatched #${id} as a generation 6 pup`;
        }
        default:
          return "Not simulated";
      }
    },
    reset() {
      friends = initialFriends();
      protocol = initialProtocol();
      egg = 700_001n;
      burnedByHousehold = HOUSEHOLD_RANK_BURNED_RF;
      householdActions = 24;
      Object.assign(snapshot, initialSnapshot());
    },
  };
}
