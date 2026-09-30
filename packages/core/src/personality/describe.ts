/**
 * Personality = pure function of (family, seed). Names, temperament, favourite hour,
 * secret habit and hunger threshold; nothing here reads the chain.
 */
import { FAMILY_NAMES, type FamilyName } from "../protocol/constants.js";
import type { FriendIdentity, Personality } from "../types.js";
import { seedHash, seedPick } from "./hash.js";
import { HUNGER_THRESHOLDS, SECRET_HABITS, SYLLABLES, TEMPERAMENTS } from "./tables.js";

/** What describe() needs from a Friend; a full Friend or FriendIdentity works. */
export type DescribableFriend = Pick<FriendIdentity, "tokenId"> & Partial<Pick<FriendIdentity, "seed" | "family">>;

function familyIndex(family: number): number {
  if (!Number.isInteger(family) || family < 0 || family >= FAMILY_NAMES.length) {
    throw new RangeError(`family must be 0..${FAMILY_NAMES.length - 1}, got ${family}`);
  }
  return family;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

/** 2 or 3 syllables from the family table, deterministic in the seed. */
export function nameFor(seed: number, family: number): string {
  const f = familyIndex(family);
  const table = SYLLABLES[f]!;
  const onset = seedPick(table.onsets, seed, "name", "onset");
  const ending = seedPick(table.endings, seed, "name", "ending");
  const three = seedHash(seed, "name", "length") % 2 === 1;
  const middle = three ? seedPick(table.middles, seed, "name", "middle") : "";
  return capitalize(onset + middle + ending);
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

/**
 * Builds the Personality. `seed` and `family` default to the Friend's own fields
 * (seedOf(id) == id today, so the token id is the last resort for the seed).
 */
export function describe(friend: DescribableFriend, seed?: number, family?: number): Personality {
  const s = seed ?? friend.seed ?? Number(friend.tokenId);
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

export function familyIdOf(name: FamilyName): number {
  return FAMILY_NAMES.indexOf(name);
}
