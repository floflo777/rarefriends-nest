/**
 * Mock data source: real core types built from Robinhood Chain reads on 2026-09-30 plus a
 * synthetic demo household. `simulate(action)` applies the Steward's own prepared calldata
 * to the fixtures the way the protocol would (claim, upgrade, promote, activate, hardwire,
 * RF transfer), so the demo runs the exact same planner, vitals and personality as live
 * mode. Nothing here touches a wallet or the chain.
 */
import { decodeFunctionData, isAddressEqual, parseEther } from "viem";
import type { Address } from "viem";
import {
  ACTIVATION_MANAGER_ABI,
  ADDRESSES,
  ERC20_ABI,
  FAMILY_NAMES,
  FRAME_COUNT,
  activateCostWei,
  asciiToFrame,
  frameToRows,
  hardwireCostWei,
  promoteCostWei,
  rfToWei,
  rowsToFrame,
  upgradeCostWei,
  weiToRf,
  weightFor,
  type Collection,
  type Friend,
  type Household,
  type PetFrame,
  type ProtocolState,
  type Snapshot,
  type Sprite,
  type StewardAction,
} from "@nest/core";
import { SourceError, type NestDataSource } from "./source.js";

/** Friend 1969 (Generations, family Asymmetry), frame 0 of its 64 on-chain frames. */
export const FRIEND_1969_FRAME = `
................
................
................
................
................
....#......#....
....########....
....#..##..#....
....########....
.....######.#...
.....##..####...
.....#######....
.....######.....
.....##..##.....
.....##..##.....
................`;

/** A generic pup silhouette for Friends whose frames are not hardcoded. */
const GENERIC_FRAME = `
................
................
................
......####......
.....#....#.....
....#.#..#.#....
....#......#....
....#.####.#....
.....#....#.....
......####......
.....#....#.....
....#......#....
....#......#....
.....#....#.....
......####......
................`;

export const DEMO_OWNER: Address = "0xd3a0d3a0d3a0d3a0d3a0d3a0d3a0d3a0d3a0d3a0";
const DEMO_RF_BALANCE = parseEther("250000");
const FIRST_EGG = 700_001n;
const HOUSEHOLD_RANK_BURNED_RF = 84_500;

function tba(tokenId: bigint, collection: Collection): Address {
  const tag = collection === "Genesis" ? "6e" : "9e";
  return `0x${tag}${tokenId.toString(16).padStart(38, "0")}` as Address;
}

function shift(frame: PetFrame, dy: number): PetFrame {
  const rows = frameToRows(frame);
  const blank = () => Array.from({ length: 16 }, () => false);
  const out = dy > 0 ? [...Array.from({ length: dy }, blank), ...rows.slice(0, 16 - dy)] : [...rows.slice(-dy), ...Array.from({ length: -dy }, blank)];
  return rowsToFrame(out);
}

function mirror(frame: PetFrame): PetFrame {
  return rowsToFrame(frameToRows(frame).map((row) => [...row].reverse()));
}

/** 64 frames from one pose: the idle clip bobs, the walk clip steps and turns. */
export function spriteFromPose(ascii: string): Sprite {
  const base = asciiToFrame(ascii);
  const up = shift(base, -1);
  const flipped = mirror(base);
  const flippedUp = shift(flipped, -1);
  const frames: PetFrame[] = [];
  for (let i = 0; i < FRAME_COUNT / 2; i++) frames.push(Math.floor(i / 8) % 2 === 0 ? base : up);
  for (let i = 0; i < FRAME_COUNT / 2; i++) {
    const turned = Math.floor(i / 16) % 2 === 1;
    const step = Math.floor(i / 4) % 2 === 1;
    frames.push(turned ? (step ? flippedUp : flipped) : step ? up : base);
  }
  return { frames, idle: frames.slice(0, FRAME_COUNT / 2), walk: frames.slice(FRAME_COUNT / 2) };
}

function generationsFriend(tokenId: number, generation: number, tier: number, family: number, extra: Partial<Friend> = {}): Friend {
  return {
    collection: "Generations",
    tokenId: BigInt(tokenId),
    owner: DEMO_OWNER,
    wallet: tba(BigInt(tokenId), "Generations"),
    generation,
    family,
    familyName: FAMILY_NAMES[family] ?? "Skeleton",
    seed: tokenId,
    position: { tier, weight: rfToWei(weightFor("Generations", generation, tier)), active: true },
    rewards: { earnedRf: 0n, earnedWeth: 0n },
    savings: { rf: 0n, weth: 0n, eth: 0n },
    ...extra,
  };
}

function initialFriends(): Friend[] {
  return [
    // Real facts: Gen 1 tier 2, weight 416,250, family Asymmetry, 36,189 RF + 0.0228 WETH unclaimed.
    generationsFriend(1969, 1, 2, 4, {
      rewards: { earnedRf: parseEther("36189"), earnedWeth: parseEther("0.0228") },
      savings: { rf: parseEther("12400"), weth: parseEther("0.0912"), eth: parseEther("0.004") },
    }),
    // Real facts: Gen 4 tier 1, weight 198.75. Family is a placeholder.
    generationsFriend(343695, 4, 1, 5, {
      rewards: { earnedRf: parseEther("3.2"), earnedWeth: 0n },
      savings: { rf: parseEther("41"), weth: 0n, eth: 0n },
    }),
    // Synthetic Gen 6 pup: 1 RF hardwired, weight 1.10, never fed.
    generationsFriend(612044, 6, 0, 3, { rewards: { earnedRf: parseEther("0.0141"), earnedWeth: 0n } }),
    // Synthetic inactive Genesis Friend (weight 0): the Wake action.
    {
      collection: "Genesis",
      tokenId: 77n,
      owner: DEMO_OWNER,
      wallet: tba(77n, "Genesis"),
      generation: 0,
      family: 7,
      familyName: "Sparkling",
      seed: 77,
      position: { tier: 0, weight: 0n, active: false },
      rewards: { earnedRf: 0n, earnedWeth: 0n },
      savings: { rf: 0n, weth: 0n, eth: 0n },
    },
  ];
}

function initialProtocol(): ProtocolState {
  const now = Math.floor(Date.now() / 1000);
  const periodFinish = now + 3 * 86_400;
  return {
    blockNumber: 76_460_000n,
    timestamp: now,
    totalWeight: parseEther("1068713093.63"),
    rfStream: { amount: parseEther("8547984.3"), periodFinish, lastUpdate: now - 6 * 3600 },
    wethStream: { amount: parseEther("1.6288"), periodFinish, lastUpdate: now - 6 * 3600 },
    rfTotalSupply: parseEther("947740000"),
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
  const others = [4_212_500, 2_900_000, 1_150_000, 640_000, HOUSEHOLD_RANK_BURNED_RF, 61_000, 25_300, 9_950, 2_100, 505];
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
    genesis: { activated: 495, inactive: 118, reserveHeld: 411 },
  };
}

export interface MockSource extends NestDataSource {
  /** Apply a Steward action's prepared transactions to the fixtures (demo mode). Returns a one-line description. */
  simulate(action: StewardAction): string;
  /** Reset fixtures to their initial state (tests). */
  reset(): void;
}

const rf = (wei: bigint) => weiToRf(wei).toLocaleString("en-US", { maximumFractionDigits: 2 });

function collectionOf(address: Address): Collection {
  return isAddressEqual(address, ADDRESSES.genesis) ? "Genesis" : "Generations";
}

export function createMockSource(): MockSource {
  let friends = initialFriends();
  let protocol = initialProtocol();
  let egg: bigint | null = FIRST_EGG;
  let rfBalance = DEMO_RF_BALANCE;
  let rfAllowance = 0n;
  let burnedByHousehold = HOUSEHOLD_RANK_BURNED_RF;
  let householdActions = 24;
  let snapshot = initialSnapshot();

  const find = (collection: Collection, tokenId: bigint): Friend | null => friends.find((f) => f.collection === collection && f.tokenId === tokenId) ?? null;
  const replace = (updated: Friend): void => {
    friends = friends.map((f) => (f.collection === updated.collection && f.tokenId === updated.tokenId ? updated : f));
  };

  /** A paid action: RF leaves the wallet, half is burned, half streams; weight moves. */
  const pay = (costWei: bigint, deltaWeight: bigint): void => {
    rfBalance -= costWei;
    rfAllowance = 0n;
    const burned = costWei / 2n;
    burnedByHousehold += weiToRf(burned);
    householdActions += 1;
    protocol = { ...protocol, rfTotalSupply: protocol.rfTotalSupply - burned, totalWeight: protocol.totalWeight + deltaWeight };
    snapshot = { ...snapshot, totals: { ...snapshot.totals, burnedRf: snapshot.totals.burnedRf + weiToRf(burned) } };
    const board = snapshot.leaderboard.map((r) => (isAddressEqual(r.owner, DEMO_OWNER) ? { ...r, burnedRf: burnedByHousehold, actions: householdActions } : r));
    snapshot.leaderboard = board.sort((a, b) => b.burnedRf - a.burnedRf);
  };

  const applyErc20 = (data: `0x${string}`): string => {
    const call = decodeFunctionData({ abi: ERC20_ABI, data });
    if (call.functionName === "approve") {
      rfAllowance = call.args[1];
      return "";
    }
    if (call.functionName === "transfer") {
      const [to, amount] = call.args;
      const target = friends.find((f) => isAddressEqual(f.wallet, to));
      rfBalance -= amount;
      if (target) replace({ ...target, savings: { ...target.savings, rf: target.savings.rf + amount } });
      return `Saved ${rf(amount)} RF into ${target ? `#${target.tokenId}'s` : "the"} wallet`;
    }
    throw new Error(`mock: unsupported RF call ${call.functionName}`);
  };

  const applyManager = (data: `0x${string}`): string => {
    const call = decodeFunctionData({ abi: ACTIVATION_MANAGER_ABI, data });
    switch (call.functionName) {
      case "claim": {
        const [asset, collection, tokenId] = call.args;
        const friend = find(collectionOf(collection), tokenId);
        if (!friend) throw new Error("mock: claim on an unknown Friend");
        const isRf = isAddressEqual(asset, ADDRESSES.rf);
        const amount = isRf ? friend.rewards.earnedRf : friend.rewards.earnedWeth;
        replace({
          ...friend,
          rewards: isRf ? { ...friend.rewards, earnedRf: 0n } : { ...friend.rewards, earnedWeth: 0n },
          savings: isRf ? { ...friend.savings, rf: friend.savings.rf + amount } : { ...friend.savings, weth: friend.savings.weth + amount },
        });
        return `Fed #${friend.tokenId}: ${isRf ? `${rf(amount)} RF` : `${weiToRf(amount).toFixed(4)} WETH`} claimed to its wallet`;
      }
      case "upgrade": {
        const [collection, tokenId] = call.args;
        const friend = find(collectionOf(collection), tokenId);
        if (!friend) throw new Error("mock: upgrade on an unknown Friend");
        const tier = friend.position.tier + 1;
        const weight = rfToWei(weightFor(friend.collection, friend.generation, tier));
        pay(upgradeCostWei(friend.collection, friend.generation, friend.position.tier), weight - friend.position.weight);
        replace({ ...friend, position: { tier, weight, active: true } });
        return `Trained #${friend.tokenId} to tier ${tier}`;
      }
      case "promote": {
        const [tokenId] = call.args;
        const friend = find("Generations", tokenId);
        if (!friend) throw new Error("mock: promote on an unknown Friend");
        const generation = friend.generation - 1;
        const weight = friend.position.active ? rfToWei(weightFor("Generations", generation, 0)) : friend.position.weight;
        pay(promoteCostWei(friend.generation), weight - friend.position.weight);
        replace({ ...friend, generation, position: { tier: 0, weight, active: friend.position.active } });
        return `Raised #${friend.tokenId} to Gen ${generation}`;
      }
      case "activate": {
        const [collection, tokenId] = call.args;
        const friend = find(collectionOf(collection), tokenId);
        if (!friend) throw new Error("mock: activate on an unknown Friend");
        const weight = rfToWei(weightFor(friend.collection, friend.generation, friend.position.tier));
        pay(activateCostWei(friend.collection, friend.generation), weight);
        replace({ ...friend, position: { ...friend.position, weight, active: true } });
        return `Woke ${friend.collection} #${friend.tokenId}`;
      }
      case "hardwire": {
        const [generation] = call.args;
        if (egg === null) throw new Error("mock: no egg to hatch");
        const id = Number(egg);
        const pup = generationsFriend(id, generation, 0, id % FAMILY_NAMES.length);
        friends = [...friends, pup];
        pay(hardwireCostWei(generation), pup.position.weight);
        egg = egg + 1n;
        return `Hatched #${id} as a Gen-${generation} pup`;
      }
      default:
        throw new Error(`mock: unsupported protocol call ${call.functionName}`);
    }
  };

  return {
    async protocolState() {
      return protocol;
    },
    async friend(collection, tokenId) {
      const f = find(collection, tokenId);
      if (!f) throw new SourceError("not-found", `${collection} #${tokenId} is not in the demo household`);
      return f;
    },
    async household(owner): Promise<Household> {
      const mine = isAddressEqual(owner, DEMO_OWNER);
      return {
        owner,
        friends: mine ? friends.slice() : [],
        eggTokenId: mine ? egg : null,
        rfBalance: mine ? rfBalance : 0n,
        rfAllowance: mine ? rfAllowance : 0n,
      };
    },
    async snapshot() {
      return { ...snapshot, leaderboard: snapshot.leaderboard.map((r) => ({ ...r })) };
    },
    async sprite(friend): Promise<Sprite> {
      return spriteFromPose(friend.collection === "Generations" && friend.tokenId === 1969n ? FRIEND_1969_FRAME : GENERIC_FRAME);
    },
    simulate(action) {
      let line = "";
      for (const tx of action.txs) {
        const result = isAddressEqual(tx.to, ADDRESSES.rf) ? applyErc20(tx.data) : isAddressEqual(tx.to, ADDRESSES.activationManager) ? applyManager(tx.data) : "";
        if (result) line = line ? `${line}; ${result}` : result;
      }
      return line || `Nothing to do for ${action.label}`;
    },
    reset() {
      friends = initialFriends();
      protocol = initialProtocol();
      egg = FIRST_EGG;
      rfBalance = DEMO_RF_BALANCE;
      rfAllowance = 0n;
      burnedByHousehold = HOUSEHOLD_RANK_BURNED_RF;
      householdActions = 24;
      snapshot = initialSnapshot();
    },
  };
}
