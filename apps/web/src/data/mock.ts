/**
 * Demo data source: a real household baked from Robinhood Chain (`fixtures/demo.json`,
 * written by `scripts/bake-demo.ts`) plus local simulation of the Steward's actions.
 *
 * Every Friend is real: identity, family and seed from the registry (so core `describe`
 * gives its real name), position, rewards, savings and its 64 on-chain frames. What the demo
 * simulates: `simulate(action)` applies the planner's own calldata to this state the way the
 * protocol would (claim, upgrade, promote, activate, hardwire, RF transfer, ERC-6551
 * withdraw), and unclaimed rewards keep accruing at the Friend's real weekly rate
 * (weight / totalWeight x stream) accelerated DEMO_TIME_SCALE times, so hunger visibly
 * returns after a Feed. Nothing here touches a wallet or the chain; the dry-run of a
 * confirmed action against the live RPC lives in `screens/run.ts`.
 */
import { decodeFunctionData, isAddressEqual } from "viem";
import type { Address } from "viem";
import {
  ACTIVATION_MANAGER_ABI,
  ADDRESSES,
  ERC20_ABI,
  ERC6551_ACCOUNT_ABI,
  FAMILY_NAMES,
  FRAME_COUNT,
  activateCostWei,
  asciiToFrame,
  createNestClient,
  decodeFrames,
  decodePortrait8,
  frameToRows,
  hardwireCostWei,
  promoteCostWei,
  rfToWei,
  rowsToFrame,
  upgradeCostWei,
  weeklyRfFor,
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
import demoJson from "./fixtures/demo.json";
import type { DemoFixture, FixtureFriend, FixtureProtocol } from "./fixtures/schema.js";
import type { TokenScene } from "../model/scene.js";
import { createLiveSource, portraitToFrame, stillSprite } from "./live.js";
import { SourceError, friendKey, type NestDataSource } from "./source.js";

/** Friend 1969 (Generations, family Asymmetry), frame 0 of its 64 on-chain frames (LCD tests). */
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

/** Placeholder silhouette for a pup hatched during the demo: it has no registry frames yet. */
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

/** Key of the household's own RF balance in the set of simulated-only state. */
const HOUSEHOLD = "household";

/** Rewards accrue this many times faster than on chain, so hunger returns within minutes. */
export const DEMO_TIME_SCALE = 1000;
const WEEK_S = 7 * 86_400;

/** The baked household, as committed. */
export const DEMO_FIXTURE: DemoFixture = demoJson as unknown as DemoFixture;
/** The real owner of the demo household. */
export const DEMO_OWNER: Address = DEMO_FIXTURE.owner;

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

/** The fixture turned back into core types. */
export interface LoadedFixture {
  owner: Address;
  bakedAt: number; // unix seconds
  blockNumber: bigint;
  friends: Friend[];
  /** By `friendKey`. */
  sprites: Map<string, Sprite>;
  eggTokenId: bigint | null;
  rfBalance: bigint;
  rfAllowance: bigint;
  /** As baked: real stream timestamps. */
  protocol: ProtocolState;
  census: Snapshot | null;
}

function bigintOf(raw: string, label: string): bigint {
  if (!/^\d+$/.test(raw)) throw new TypeError(`fixture ${label}: expected a decimal bigint string, got ${raw}`);
  return BigInt(raw);
}

function friendOf(f: FixtureFriend): Friend {
  const label = `${f.collection} #${f.tokenId}`;
  if (f.collection !== "Generations" && f.collection !== "Genesis") throw new TypeError(`fixture ${label}: unknown collection`);
  const out: Friend = {
    collection: f.collection,
    tokenId: bigintOf(f.tokenId, `${label} tokenId`),
    owner: f.owner,
    wallet: f.wallet,
    generation: f.generation,
    position: { tier: f.position.tier, weight: bigintOf(f.position.weight, `${label} weight`), active: f.position.active },
    rewards: { earnedRf: bigintOf(f.rewards.earnedRf, `${label} earnedRf`), earnedWeth: bigintOf(f.rewards.earnedWeth, `${label} earnedWeth`) },
    savings: { rf: bigintOf(f.savings.rf, `${label} rf`), weth: bigintOf(f.savings.weth, `${label} weth`), eth: bigintOf(f.savings.eth, `${label} eth`) },
  };
  if (f.family !== undefined) {
    if (FAMILY_NAMES[f.family] === undefined) throw new RangeError(`fixture ${label}: family ${f.family} is not a registry family`);
    out.family = f.family;
  }
  if (f.seed !== undefined) out.seed = f.seed;
  if (f.familyName !== undefined) {
    if (f.familyName !== "Genesis" && !(FAMILY_NAMES as readonly string[]).includes(f.familyName)) throw new RangeError(`fixture ${label}: unknown family name ${f.familyName}`);
    out.familyName = f.familyName as NonNullable<Friend["familyName"]>;
  }
  return out;
}

function protocolOf(p: FixtureProtocol, blockNumber: bigint): ProtocolState {
  return {
    blockNumber,
    timestamp: p.timestamp,
    totalWeight: bigintOf(p.totalWeight, "totalWeight"),
    rfStream: { amount: bigintOf(p.rfStream.amount, "rfStream.amount"), periodFinish: p.rfStream.periodFinish, lastUpdate: p.rfStream.lastUpdate },
    wethStream: { amount: bigintOf(p.wethStream.amount, "wethStream.amount"), periodFinish: p.wethStream.periodFinish, lastUpdate: p.wethStream.lastUpdate },
    rfTotalSupply: bigintOf(p.rfTotalSupply, "rfTotalSupply"),
  };
}

/** Parses and validates a baked fixture; throws on anything that is not a real, complete record. */
export function loadFixture(fixture: DemoFixture = DEMO_FIXTURE): LoadedFixture {
  if (!Array.isArray(fixture.friends) || fixture.friends.length === 0) throw new TypeError("fixture: no Friends");
  const bakedAt = Math.floor(Date.parse(fixture.bakedAt) / 1000);
  if (!Number.isFinite(bakedAt)) throw new TypeError(`fixture: bad bakedAt ${fixture.bakedAt}`);
  const blockNumber = bigintOf(fixture.blockNumber, "blockNumber");
  const friends = fixture.friends.map(friendOf);
  const sprites = new Map<string, Sprite>();
  fixture.friends.forEach((f, i) => {
    const words = fixture.sprites[f.sprite];
    if (!words) throw new TypeError(`fixture ${f.collection} #${f.tokenId}: sprite ${f.sprite} missing`);
    const key = friendKey(friends[i]!.collection, friends[i]!.tokenId);
    if (words.kind === "frames") {
      sprites.set(key, decodeFrames(words.words.map((w) => BigInt(w))));
    } else {
      if (words.words.length !== 1) throw new TypeError(`fixture sprite ${f.sprite}: a portrait is one word`);
      sprites.set(key, stillSprite(portraitToFrame(decodePortrait8(BigInt(words.words[0]!)))));
    }
  });
  const census = fixture.census;
  return {
    owner: fixture.owner,
    bakedAt,
    blockNumber,
    friends,
    sprites,
    eggTokenId: fixture.household.eggTokenId === null ? null : bigintOf(fixture.household.eggTokenId, "eggTokenId"),
    rfBalance: bigintOf(fixture.household.rfBalance, "rfBalance"),
    rfAllowance: bigintOf(fixture.household.rfAllowance, "rfAllowance"),
    protocol: protocolOf(fixture.protocol, blockNumber),
    census: census
      ? { blockNumber: census.blockNumber, timestamp: census.timestamp, totals: census.totals, daily: census.daily, leaderboard: census.leaderboard, hardwired: census.hardwired, genesis: census.genesis }
      : null,
  };
}

export interface MockOptions {
  /** The real indexer snapshot (live.ts `snapshot()`), tried before the fixture's copy. */
  snapshot?: () => Promise<Snapshot>;
  /** The Friend's real on-chain scene (live.ts `scene()`). Default: a live source on its own client, created on first use. */
  scene?: (friend: Friend) => Promise<TokenScene>;
  /** Clock in milliseconds (tests). Default Date.now. */
  now?: () => number;
  /** Accrual acceleration. Default DEMO_TIME_SCALE. */
  timeScale?: number;
  fixture?: DemoFixture;
}

export interface MockSource extends NestDataSource {
  /** Apply a Steward action's prepared transactions to the fixtures (demo mode). Returns a one-line description. */
  simulate(action: StewardAction): string;
  /**
   * True when the action's on-chain precondition may exist only in this simulation: its Friend
   * (or, for Hatch and Save, the household balance) was changed by an earlier simulated action,
   * so a dry-run against the real chain would judge a state that is not there.
   */
  isSimulated(action: StewardAction): boolean;
  /** Reset fixtures to their initial state (tests). */
  reset(): void;
  readonly timeScale: number;
  readonly fixture: LoadedFixture;
}

const rf = (wei: bigint) => weiToRf(wei).toLocaleString("en-US", { maximumFractionDigits: 2 });

function collectionOf(address: Address): Collection {
  return isAddressEqual(address, ADDRESSES.genesis) ? "Genesis" : "Generations";
}

/** RF units to wei at nano-RF precision (accrual amounts are arbitrary floats). */
function accruedWei(rfUnits: number): bigint {
  if (!(rfUnits > 0)) return 0n;
  return BigInt(Math.round(rfUnits * 1e9)) * 10n ** 9n;
}

/** A Friend plus the moment its stored rewards were exact; rewards are projected forward on read. */
interface Pet {
  friend: Friend;
  since: number; // unix seconds
}

export function createMockSource(options: MockOptions = {}): MockSource {
  const fixture = loadFixture(options.fixture);
  const clock = options.now ?? Date.now;
  const timeScale = options.timeScale ?? DEMO_TIME_SCALE;
  const nowS = () => clock() / 1000;

  let sessionStart = nowS();
  let pets = new Map<string, Pet>();
  let protocol: ProtocolState = fixture.protocol;
  let egg: bigint | null = fixture.eggTokenId;
  let rfBalance = fixture.rfBalance;
  let rfAllowance = fixture.rfAllowance;
  /** Burns and actions the demo added on top of the real snapshot. */
  let burnedDeltaRf = 0;
  let actionsDelta = 0;
  let lastActionAt = 0;
  let baseSnapshot: Promise<Snapshot> | null = null;
  const hatchedSprites = new Map<string, Sprite>();
  /**
   * State that exists only in this simulation: `position:<key>` (tier, generation, awake),
   * `savings:<key>` (the Friend's wallet balance), and HOUSEHOLD (the owner's RF balance).
   */
  const touched = new Set<string>();
  const mark = (aspect: "position" | "savings", f: Pick<Friend, "collection" | "tokenId">): void => {
    touched.add(`${aspect}:${friendKey(f.collection, f.tokenId)}`);
  };
  let readScene = options.scene;

  const init = (): void => {
    sessionStart = nowS();
    pets = new Map(fixture.friends.map((friend) => [friendKey(friend.collection, friend.tokenId), { friend, since: sessionStart }]));
    // The stream is re-funded weekly on chain; the baked period is anchored on this session so the
    // fixture keeps streaming (and hunger keeps meaning something) however long after the bake it runs.
    protocol = {
      ...fixture.protocol,
      rfStream: { ...fixture.protocol.rfStream, lastUpdate: Math.floor(sessionStart), periodFinish: Math.floor(sessionStart) + WEEK_S },
      wethStream: { ...fixture.protocol.wethStream, lastUpdate: Math.floor(sessionStart), periodFinish: Math.floor(sessionStart) + WEEK_S },
    };
    egg = fixture.eggTokenId;
    rfBalance = fixture.rfBalance;
    rfAllowance = fixture.rfAllowance;
    burnedDeltaRf = 0;
    actionsDelta = 0;
    lastActionAt = 0;
    hatchedSprites.clear();
    touched.clear();
  };
  init();

  /** Rewards at `at`: stored base plus the real weekly rate over the elapsed time, accelerated. */
  const project = (pet: Pet, at: number): Friend => {
    const weeks = (Math.max(0, at - pet.since) / WEEK_S) * timeScale;
    if (weeks === 0 || !pet.friend.position.active) return pet.friend;
    const weight = weiToRf(pet.friend.position.weight);
    const total = weiToRf(protocol.totalWeight);
    const rfPerWeek = weeklyRfFor(weight, total, weiToRf(protocol.rfStream.amount));
    const wethPerWeek = weeklyRfFor(weight, total, weiToRf(protocol.wethStream.amount));
    return {
      ...pet.friend,
      rewards: { earnedRf: pet.friend.rewards.earnedRf + accruedWei(rfPerWeek * weeks), earnedWeth: pet.friend.rewards.earnedWeth + accruedWei(wethPerWeek * weeks) },
    };
  };

  const current = (): Friend[] => {
    const at = nowS();
    return [...pets.values()].map((p) => project(p, at));
  };
  const find = (collection: Collection, tokenId: bigint): Friend | null => {
    const pet = pets.get(friendKey(collection, tokenId));
    return pet ? project(pet, nowS()) : null;
  };
  /** Stores `updated` with its rewards exact now (accrual restarts from this moment). */
  const put = (updated: Friend): void => {
    pets.set(friendKey(updated.collection, updated.tokenId), { friend: updated, since: nowS() });
  };
  /** The household's own RF balance moved (a simulated spend, save or withdraw). */
  const touchHousehold = (): void => {
    touched.add(HOUSEHOLD);
  };

  /**
   * A paid action: RF leaves the payer's wallet, half is burned, half streams; weight moves.
   * The payer is the Friend's real owner: an extra pet's spend never comes out of the household.
   */
  const pay = (costWei: bigint, deltaWeight: bigint, payer: Address): void => {
    if (isAddressEqual(payer, fixture.owner)) {
      rfBalance -= costWei;
      rfAllowance = 0n;
      touchHousehold();
    }
    const burned = costWei / 2n;
    burnedDeltaRf += weiToRf(burned);
    actionsDelta += 1;
    lastActionAt = Math.floor(nowS());
    protocol = { ...protocol, rfTotalSupply: protocol.rfTotalSupply - burned, totalWeight: protocol.totalWeight + deltaWeight };
  };

  const applyErc20 = (data: `0x${string}`): string => {
    const call = decodeFunctionData({ abi: ERC20_ABI, data });
    if (call.functionName === "approve") {
      rfAllowance = call.args[1];
      return "";
    }
    if (call.functionName === "transfer") {
      const [to, amount] = call.args;
      const target = current().find((f) => isAddressEqual(f.wallet, to));
      rfBalance -= amount;
      touchHousehold();
      if (target) {
        put({ ...target, savings: { ...target.savings, rf: target.savings.rf + amount } });
        mark("savings", target);
      }
      return `Saved ${rf(amount)} RF into ${target ? `#${target.tokenId}'s` : "the"} wallet`;
    }
    throw new Error(`mock: unsupported RF call ${call.functionName}`);
  };

  /** Withdraw: execute(RF, 0, transfer(owner, amount), CALL) on the Friend's ERC-6551 wallet. */
  const applyAccount = (wallet: Address, data: `0x${string}`): string => {
    const friend = current().find((f) => isAddressEqual(f.wallet, wallet));
    if (!friend) throw new Error("mock: execute on an unknown wallet");
    const call = decodeFunctionData({ abi: ERC6551_ACCOUNT_ABI, data });
    const [target, , inner] = call.args;
    if (!isAddressEqual(target, ADDRESSES.rf)) throw new Error("mock: execute targets something other than RF");
    const transfer = decodeFunctionData({ abi: ERC20_ABI, data: inner });
    if (transfer.functionName !== "transfer") throw new Error(`mock: unsupported inner call ${transfer.functionName}`);
    const [to, amount] = transfer.args;
    put({ ...friend, savings: { ...friend.savings, rf: friend.savings.rf - amount } });
    mark("savings", friend);
    if (isAddressEqual(to, fixture.owner)) {
      rfBalance += amount;
      touchHousehold();
    }
    return `Withdrew ${rf(amount)} RF from #${friend.tokenId}'s wallet`;
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
        put({
          ...friend,
          rewards: isRf ? { ...friend.rewards, earnedRf: 0n } : { ...friend.rewards, earnedWeth: 0n },
          savings: isRf ? { ...friend.savings, rf: friend.savings.rf + amount } : { ...friend.savings, weth: friend.savings.weth + amount },
        });
        mark("savings", friend);
        return `Fed #${friend.tokenId}: ${isRf ? `${rf(amount)} RF` : `${weiToRf(amount).toFixed(4)} WETH`} claimed to its wallet`;
      }
      case "upgrade": {
        const [collection, tokenId] = call.args;
        const friend = find(collectionOf(collection), tokenId);
        if (!friend) throw new Error("mock: upgrade on an unknown Friend");
        const tier = friend.position.tier + 1;
        const weight = rfToWei(weightFor(friend.collection, friend.generation, tier));
        pay(upgradeCostWei(friend.collection, friend.generation, friend.position.tier), weight - friend.position.weight, friend.owner);
        put({ ...friend, position: { tier, weight, active: true } });
        mark("position", friend);
        return `Trained #${friend.tokenId} to tier ${tier}`;
      }
      case "promote": {
        const [tokenId] = call.args;
        const friend = find("Generations", tokenId);
        if (!friend) throw new Error("mock: promote on an unknown Friend");
        const generation = friend.generation - 1;
        const weight = friend.position.active ? rfToWei(weightFor("Generations", generation, 0)) : friend.position.weight;
        pay(promoteCostWei(friend.generation), weight - friend.position.weight, friend.owner);
        put({ ...friend, generation, position: { tier: 0, weight, active: friend.position.active } });
        mark("position", friend);
        return `Raised #${friend.tokenId} to Gen ${generation}`;
      }
      case "activate": {
        const [collection, tokenId] = call.args;
        const friend = find(collectionOf(collection), tokenId);
        if (!friend) throw new Error("mock: activate on an unknown Friend");
        const weight = rfToWei(weightFor(friend.collection, friend.generation, friend.position.tier));
        pay(activateCostWei(friend.collection, friend.generation), weight, friend.owner);
        put({ ...friend, position: { ...friend.position, weight, active: true } });
        mark("position", friend);
        return `Woke ${friend.collection} #${friend.tokenId}`;
      }
      case "hardwire": {
        const [generation] = call.args;
        if (egg === null) throw new Error("mock: no egg to hatch");
        const id = egg;
        // Family, name and frames are the registry's business once the pup exists on chain: none is invented here.
        const pup: Friend = {
          collection: "Generations",
          tokenId: id,
          owner: fixture.owner,
          wallet: `0x9e${id.toString(16).padStart(38, "0")}` as Address,
          generation,
          position: { tier: 0, weight: rfToWei(weightFor("Generations", generation, 0)), active: true },
          rewards: { earnedRf: 0n, earnedWeth: 0n },
          savings: { rf: 0n, weth: 0n, eth: 0n },
        };
        pay(hardwireCostWei(generation), pup.position.weight, fixture.owner);
        put(pup);
        hatchedSprites.set(friendKey(pup.collection, pup.tokenId), spriteFromPose(GENERIC_FRAME));
        egg = id + 1n;
        return `Hatched #${id} as a Gen-${generation} pup (placeholder art until it exists on chain)`;
      }
      default:
        throw new Error(`mock: unsupported protocol call ${call.functionName}`);
    }
  };

  const loadBaseSnapshot = (): Promise<Snapshot> => {
    if (baseSnapshot) return baseSnapshot;
    const p = (async () => {
      if (options.snapshot) {
        try {
          return await options.snapshot();
        } catch {
          // Fall back to the copy baked with the fixture.
        }
      }
      if (fixture.census) return fixture.census;
      throw new SourceError("unavailable", "no snapshot: the indexer has not run and the fixture carries none");
    })();
    baseSnapshot = p;
    p.catch(() => {
      baseSnapshot = null;
    });
    return p;
  };

  /** The real snapshot with the demo's own burns added to the household's row and the totals. */
  const overlay = (base: Snapshot): Snapshot => {
    const board = base.leaderboard.map((r) => ({ ...r }));
    if (burnedDeltaRf > 0) {
      const mine = board.find((r) => isAddressEqual(r.owner, fixture.owner));
      if (mine) {
        mine.burnedRf += burnedDeltaRf;
        mine.actions += actionsDelta;
        mine.lastActionAt = lastActionAt;
      } else {
        board.push({ owner: fixture.owner, burnedRf: burnedDeltaRf, actions: actionsDelta, lastActionAt });
      }
      board.sort((a, b) => b.burnedRf - a.burnedRf);
    }
    return { ...base, totals: { ...base.totals, burnedRf: base.totals.burnedRf + burnedDeltaRf }, leaderboard: board };
  };

  return {
    timeScale,
    fixture,

    async protocolState() {
      return { ...protocol, timestamp: Math.floor(nowS()) };
    },
    async friend(collection, tokenId) {
      const f = find(collection, tokenId);
      if (!f) throw new SourceError("not-found", `${collection} #${tokenId} is not in the demo household`);
      return f;
    },
    async household(owner): Promise<Household> {
      const mine = isAddressEqual(owner, fixture.owner);
      return {
        owner,
        friends: mine ? current() : [],
        eggTokenId: mine ? egg : null,
        rfBalance: mine ? rfBalance : 0n,
        rfAllowance: mine ? rfAllowance : 0n,
      };
    },
    async snapshot() {
      return overlay(await loadBaseSnapshot());
    },
    async sprite(friend): Promise<Sprite> {
      const key = friendKey(friend.collection, friend.tokenId);
      const sprite = fixture.sprites.get(key) ?? hatchedSprites.get(key);
      if (!sprite) throw new SourceError("not-found", `${friend.collection} #${friend.tokenId} has no sprite in the demo`);
      return sprite;
    },
    /**
     * HOME shows the Friend's real `tokenURI` scene: a read-only call, free and truthful even in
     * the demo. It is the scene as minted, so a simulated Raise does not redraw it; a pup hatched
     * here has none yet.
     */
    async scene(friend): Promise<TokenScene> {
      const key = friendKey(friend.collection, friend.tokenId);
      if (!pets.has(key)) throw new SourceError("not-found", `${friend.collection} #${friend.tokenId} is not in the demo household`);
      if (hatchedSprites.has(key)) throw new SourceError("not-found", `#${friend.tokenId} was hatched in this demo: no on-chain scene yet`);
      if (!readScene) {
        const live = createLiveSource(createNestClient());
        readScene = (f) => live.scene(f);
      }
      return readScene(friend);
    },
    simulate(action) {
      let line = "";
      for (const tx of action.txs) {
        const result = isAddressEqual(tx.to, ADDRESSES.rf)
          ? applyErc20(tx.data)
          : isAddressEqual(tx.to, ADDRESSES.activationManager)
            ? applyManager(tx.data)
            : action.kind === "withdraw"
              ? applyAccount(tx.to, tx.data)
              : "";
        if (result) line = line ? `${line}; ${result}` : result;
      }
      return line || `Nothing to do for ${action.label}`;
    },
    isSimulated(action) {
      // Hatch picks its generation from the balance; Save moves part of it.
      if (action.kind === "hatch" || action.kind === "save") return touched.has(HOUSEHOLD);
      const f = action.friend;
      if (!f) return false;
      const key = friendKey(f.collection, f.tokenId);
      if (hatchedSprites.has(key)) return true; // the pup does not exist on chain
      // Withdraw needs the savings; Train, Raise and Wake need the tier, generation and awake state.
      if (action.kind === "withdraw") return touched.has(`savings:${key}`);
      if (action.kind === "train" || action.kind === "raise" || action.kind === "wake") return touched.has(`position:${key}`);
      return false;
    },
    reset() {
      init();
      baseSnapshot = null;
    },
  };
}
