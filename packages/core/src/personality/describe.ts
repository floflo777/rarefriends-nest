/**
 * Personality = pure function of (family, seed) for Generations, of the token id for
 * Genesis. Names, temperament, favourite hour, secret habit and hunger threshold; nothing
 * here reads the chain.
 */
import { FAMILY_NAMES, type FamilyName } from "../protocol/constants.js";
import type { FriendIdentity, Personality } from "../types.js";
import { seedHash, seedPick } from "./hash.js";
import {
  GENESIS_HABITS,
  GENESIS_HUNGER_THRESHOLD,
  GENESIS_SYLLABLES,
  GENESIS_TEMPERAMENT,
  HUNGER_THRESHOLDS,
  SECRET_HABITS,
  SYLLABLES,
  TEMPERAMENTS,
  type SyllableTable,
} from "./tables.js";

/** What describe() needs from a Friend; a full Friend or FriendIdentity works. */
export type DescribableFriend = Pick<FriendIdentity, "tokenId"> & Partial<Pick<FriendIdentity, "seed" | "family" | "collection">>;

function familyIndex(family: number): number {
  if (!Number.isInteger(family) || family < 0 || family >= FAMILY_NAMES.length) {
    throw new RangeError(`family must be 0..${FAMILY_NAMES.length - 1}, got ${family}`);
  }
  return family;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

function nameFromTable(table: SyllableTable, seed: number): string {
  const onset = seedPick(table.onsets, seed, "name", "onset");
  const ending = seedPick(table.endings, seed, "name", "ending");
  const three = seedHash(seed, "name", "length") % 2 === 1;
  const middle = three ? seedPick(table.middles, seed, "name", "middle") : "";
  return capitalize(onset + middle + ending);
}

/** 2 or 3 syllables from the family table, deterministic in the seed. */
export function nameFor(seed: number, family: number): string {
  return nameFromTable(SYLLABLES[familyIndex(family)]!, seed);
}

/** Genesis name: its own syllable table, seed = token id. */
export function genesisNameFor(seed: number): string {
  return nameFromTable(GENESIS_SYLLABLES, seed);
}

export function favouriteHourFor(seed: number): number {
  return seedHash(seed, "hour") % 24;
}

export function secretHabitFor(seed: number, family: number): string {
  return seedPick(SECRET_HABITS[familyIndex(family)]!, seed, "habit");
}

export function hungerThresholdFor(family: number): number {
  return HUNGER_THRESHOLDS[familyIndex(family)]!;
}

export function temperamentFor(family: number): string {
  return TEMPERAMENTS[familyIndex(family)]!;
}

/** Personality of a Genesis Friend from its token id (no registry family). */
export function describeGenesis(seed: number): Personality {
  return {
    name: genesisNameFor(seed),
    family: "Genesis",
    temperament: GENESIS_TEMPERAMENT,
    favouriteHour: favouriteHourFor(seed),
    secretHabit: seedPick(GENESIS_HABITS, seed, "habit"),
    hungerThreshold: GENESIS_HUNGER_THRESHOLD,
    seed,
  };
}

/**
 * Builds the Personality. `seed` and `family` default to the Friend's own fields
 * (seedOf(id) == id today, so the token id is the last resort for the seed). A Friend
 * whose `collection` is "Genesis" gets the Genesis personality, never a Generations family.
 */
export function describe(friend: DescribableFriend, seed?: number, family?: number): Personality {
  const s = seed ?? friend.seed ?? Number(friend.tokenId);
  if (friend.collection === "Genesis") return describeGenesis(s);
  const f = familyIndex(family ?? friend.family ?? 0);
  const familyName: FamilyName = FAMILY_NAMES[f]!;
  return {
    name: nameFor(s, f),
    family: familyName,
    temperament: temperamentFor(f),
    favouriteHour: favouriteHourFor(s),
    secretHabit: secretHabitFor(s, f),
    hungerThreshold: hungerThresholdFor(f),
    seed: s,
  };
}

/** Registry id of a family name; -1 for "Genesis" (no registry family). */
export function familyIdOf(name: FamilyName | "Genesis"): number {
  return name === "Genesis" ? -1 : FAMILY_NAMES.indexOf(name);
}
