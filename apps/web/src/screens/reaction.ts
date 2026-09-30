/**
 * Care reactions: what the LCD plays for a few seconds once a care action's verdict is
 * known (demo: dry-run passed and the mock applied it; wallet: the last tx confirmed and
 * DONE was dismissed). Pure and clock-driven: a `Reaction` records what the action changed
 * (captured from the Friend as it was, plus the action) and `reactionFrame(r, now, reduced)`
 * says what to draw at `now`. With reduced motion the frame is the final one for the
 * whole duration, so nothing moves but the same caption is read for the same time.
 *
 *   claim -> eating        train -> training      raise -> moving
 *   hatch -> hatching      wake  -> waking        save / withdraw -> saving / withdrawing
 */
import { computeVitals, describe, type FamilyName, type Friend, type ProtocolState, type StewardAction } from "@nest/core";
import { eggIdOf } from "../model/care.js";
import { territorySteps } from "../model/pet.js";

export type ReactionKind = "eating" | "training" | "moving" | "hatching" | "waking" | "saving" | "withdrawing";

export const REACTION_DURATION_S: Readonly<Record<ReactionKind, number>> = {
  eating: 2.5,
  training: 2,
  moving: 3,
  hatching: 2.5,
  waking: 2,
  saving: 1.5,
  withdrawing: 1.5,
};

export interface Reaction {
  kind: ReactionKind;
  /** unix seconds, fractional. */
  startedAt: number;
  /** Cared-for Friend as it was when the verdict came in (null for a household hatch). */
  friend: Friend | null;
  /** Eating: the hunger bar animates from -> to (computed with core's vitals, rewards emptied). */
  hunger: { from: number; to: number };
  /** Training: tier pips light one by one up to `to`. */
  tier: { from: number; to: number };
  /** Moving: generation band segments before -> after the promote. */
  steps: { from: number; to: number };
  /** Hatching: the pup's token id (the egg's), when the label names it. */
  pupId: bigint | null;
  /** Eating: the "MMM." line in the family's own words. */
  line: string;
  demo: boolean;
}

/** Three short lines per family (and Genesis) for the eating moment; picked by token id. */
export const EATING_LINES: Readonly<Record<FamilyName | "Genesis", readonly [string, string, string]>> = {
  Skeleton: ["MMM. TO THE BONE.", "MMM. RATTLE RATTLE.", "MMM. MARROW."],
  Mask: ["MMM. SAY NOTHING.", "MMM. BEHIND THE MASK.", "MMM. NO ONE SAW."],
  Family: ["MMM. SAVED YOU SOME.", "MMM. EAT TOGETHER.", "MMM. PASS THE BOWL."],
  Cellular: ["MMM. DIVIDING.", "MMM. ABSORBED.", "MMM. CELL BY CELL."],
  Asymmetry: ["MMM. ODD BITE.", "MMM. LEFT SIDE FIRST.", "MMM. NOT QUITE EVEN."],
  Hoverer: ["MMM. FLOATING.", "MMM. LIGHTER NOW.", "MMM. DRIFT ON."],
  Colossus: ["MMM. MORE.", "MMM. BARELY A CRUMB.", "MMM. HEAVY. GOOD."],
  Sparkling: ["MMM. GLITTERY.", "MMM. SHINE SHINE.", "MMM. FIZZ."],
  Hollow: ["MMM. ECHOES.", "MMM. FILLS NOTHING.", "MMM. STILL EMPTY."],
  Genesis: ["MMM. AS EXPECTED.", "MMM. FIRST SERVED.", "MMM. NOTHING TO PROVE."],
};

/** The eating line for a Friend: its family's table (core's `describe`), variant by token id (stable per pet). */
export function eatingLine(friend: Friend): string {
  return EATING_LINES[describe(friend).family][Number(friend.tokenId % 3n)] ?? "MMM.";
}

export function reactionKindOf(action: StewardAction): ReactionKind | null {
  switch (action.kind) {
    case "claim":
      return "eating";
    case "train":
      return "training";
    case "raise":
      return "moving";
    case "hatch":
      return "hatching";
    case "wake":
      return "waking";
    case "save":
      return "saving";
    case "withdraw":
      return "withdrawing";
    default:
      return null;
  }
}

/**
 * Captures a reaction when `action` went through. `pet` is the Friend the action targets
 * (the action's own Friend, else the one on screen); its hunger after a claim is core's
 * vitals with the rewards emptied.
 */
export function startReaction(action: StewardAction, pet: Friend | null, protocol: ProtocolState | null, now: number, demo: boolean): Reaction | null {
  const kind = reactionKindOf(action);
  if (!kind) return null;
  const friend = action.friend ?? pet;
  let hunger = { from: 0, to: 0 };
  if (kind === "eating" && friend && protocol) {
    hunger = { from: computeVitals(friend, protocol, now).hunger, to: computeVitals({ ...friend, rewards: { earnedRf: 0n, earnedWeth: 0n } }, protocol, now).hunger };
  }
  const tier = friend ? { from: friend.position.tier, to: Math.min(4, friend.position.tier + 1) } : { from: 0, to: 1 };
  const steps = friend ? { from: territorySteps(friend), to: Math.min(6, territorySteps(friend) + 1) } : { from: 1, to: 2 };
  const egg = kind === "hatching" ? eggIdOf(action) : null;
  return { kind, startedAt: now, friend, hunger, tier, steps, pupId: egg ? BigInt(egg) : null, line: friend ? eatingLine(friend) : "MMM.", demo };
}

export function reactionEndsAt(r: Reaction): number {
  return r.startedAt + REACTION_DURATION_S[r.kind];
}

export function isReactionOver(r: Reaction, now: number): boolean {
  return now >= reactionEndsAt(r);
}

/** Progress in [0, 1]; reduced motion holds the final frame for the whole duration. */
export function reactionProgress(r: Reaction, now: number, reducedMotion: boolean): number {
  if (reducedMotion) return 1;
  return Math.min(1, Math.max(0, (now - r.startedAt) / REACTION_DURATION_S[r.kind]));
}

export interface ReactionFrame {
  /** Header title. */
  title: string;
  /** Caption rows under the sprite (each fits the 24-column panel). */
  caption: string[];
  /** Progress in [0, 1] (1 under reduced motion). */
  progress: number;
  /** Stepwise part: bowl fill 0..3, egg crack 0..3 (3 = the pup), zzz 0..2 (2 = sun), band/pips lit count. */
  step: number;
  /** Eating: the hunger bar's value at this instant. */
  hunger: number;
  /** Whether the sprite hops / sparkles / paces this frame (false under reduced motion). */
  moving: boolean;
}

const TITLES: Readonly<Record<ReactionKind, string>> = {
  eating: "EATING",
  training: "TRAINING",
  moving: "MOVING HOUSE",
  hatching: "HATCHING",
  waking: "WAKING",
  saving: "SAVING",
  withdrawing: "WITHDRAWING",
};

const ease = (t: number) => 1 - (1 - t) * (1 - t);

/** What to draw for `r` at `now`. */
export function reactionFrame(r: Reaction, now: number, reducedMotion: boolean): ReactionFrame {
  const progress = reactionProgress(r, now, reducedMotion);
  const moving = !reducedMotion && progress < 1;
  const base = { title: TITLES[r.kind], progress, moving, hunger: 0, step: 0 };
  switch (r.kind) {
    case "eating":
      return {
        ...base,
        // Bowl fills at 0.3 / 0.6 / 0.9; the line appears with the first spoonful.
        step: Math.min(3, Math.floor(progress / 0.3)),
        hunger: r.hunger.from + (r.hunger.to - r.hunger.from) * ease(progress),
        caption: progress >= 0.3 ? [r.line] : [],
      };
    case "training": {
      // Pips light one by one over the first three quarters, then +STRENGTH.
      const lit = Math.min(r.tier.to, r.tier.from + Math.floor((progress / 0.75) * (r.tier.to - r.tier.from + 1)));
      return { ...base, step: lit, caption: progress >= 0.5 ? ["+STRENGTH"] : [] };
    }
    case "moving":
      return { ...base, step: progress >= 0.5 ? r.steps.to : r.steps.from, caption: progress >= 0.5 ? ["NEW LAND ON CHAIN"] : [] };
    case "hatching": {
      // Three crack frames, then the pup.
      const step = Math.min(3, Math.floor(progress / 0.25));
      const caption = step >= 3 ? ["WELCOME", ...(r.demo && r.pupId !== null ? [`PUP #${r.pupId}`] : [])] : [];
      return { ...base, step, caption };
    }
    case "waking": {
      // zzz full, zzz fading, then the sun.
      const step = progress < 0.25 ? 0 : progress < 0.5 ? 1 : 2;
      return { ...base, step, caption: step === 2 ? ["AWAKE"] : [] };
    }
    case "saving":
    case "withdrawing":
      return { ...base, step: progress >= 1 ? 1 : 0, caption: progress >= 0.6 ? [r.kind === "saving" ? "SAVED" : "WITHDRAWN"] : [] };
  }
}

/** Where the device goes once a reaction ends: a move shows the new home. */
export function screenAfterReaction(r: Reaction): "HOME" | null {
  return r.kind === "moving" ? "HOME" : null;
}
