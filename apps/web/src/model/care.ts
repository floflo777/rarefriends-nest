/**
 * The CARE menu: core's Steward plan for the whole household, narrowed to the selected
 * Friend's own actions plus the household-level Hatch and Save, negligible claims last.
 * Costs, burns, weights and rationales are the planner's; this module only phrases them
 * for a 24-column LCD: a short row label, a two-line CONFIRM header, a rationale that
 * fits three full rows.
 */
import { decodeFunctionData } from "viem";
import type { Eligibility, Friend, Household, ProtocolState, StewardAction } from "@nest/core";
import { ERC20_ABI, planHousehold, upgradesPaidRf, weiToRf } from "@nest/core";
import { sameFriend } from "../data/source.js";
import { compact } from "./format.js";

export const HOUSEHOLD_KINDS: ReadonlySet<StewardAction["kind"]> = new Set(["hatch", "save"]);

export interface CareItem {
  action: StewardAction;
  /** False when the ownership gate (or read-only mode) forbids running it. */
  enabled: boolean;
  /** Why it is disabled, for the CONFIRM screen. */
  reason?: string;
}

/** Core's planner flags claims of dust (below its NEGLIGIBLE_CLAIM_RF / _WETH thresholds). */
export function isNegligible(action: StewardAction): boolean {
  return action.negligible === true;
}

/** Actions for `pet` in planner order (claims first, then by break-even), then Hatch, then Save, negligible ones last. */
export function careMenu(plan: readonly StewardAction[], pet: Friend | null): StewardAction[] {
  const own = pet ? plan.filter((a) => !HOUSEHOLD_KINDS.has(a.kind) && a.friend !== undefined && sameFriend(a.friend, pet)) : [];
  const household = ["hatch", "save"].flatMap((kind) => plan.filter((a) => a.kind === kind));
  return [...own.filter((a) => !isNegligible(a)), ...household, ...own.filter(isNegligible)];
}

export function planFor(household: Household | null, state: ProtocolState | null): StewardAction[] {
  if (!household || !state) return [];
  return planHousehold(household, state);
}

/** Applies the ownership gate: a Friend's own actions need `eligible`; household actions do not. */
export function gateMenu(actions: readonly StewardAction[], eligibility: Eligibility | "pending" | null, readOnly: boolean): CareItem[] {
  return actions.map((action) => {
    if (readOnly) return { action, enabled: false, reason: "Read only: connect the owning wallet to act." };
    if (HOUSEHOLD_KINDS.has(action.kind) || eligibility === null) return { action, enabled: true };
    if (eligibility === "pending") return { action, enabled: false, reason: "Checking ownership at a fresh block..." };
    return eligibility.eligible ? { action, enabled: true } : { action, enabled: false, reason: eligibility.reason };
  });
}

/** The hatch action, if the household has an egg it can afford. */
export function hatchOf(plan: readonly StewardAction[]): StewardAction | null {
  return plan.find((a) => a.kind === "hatch") ?? null;
}

/** First sentence of a rationale: up to the first ". " (or the whole text). */
export function firstSentence(text: string): string {
  const m = /^(.*?[.!?])(?:\s|$)/.exec(text);
  return m?.[1] ?? text;
}

/** A paid action moves RF out of the wallet; claims, saves and withdrawals do not. */
export function isPaid(action: StewardAction): boolean {
  return action.costRf > 0;
}

/** Egg id named in a hatch label ("Hatch egg #700001 as Gen-1"). */
export function eggIdOf(action: StewardAction): string | null {
  return /#(\d+)/.exec(action.label)?.[1] ?? null;
}

/** RF parked by a save action, decoded from its transfer calldata (label as a fallback). */
export function savedRfOf(action: StewardAction): number | null {
  for (const tx of action.txs) {
    try {
      const call = decodeFunctionData({ abi: ERC20_ABI, data: tx.data });
      if (call.functionName === "transfer") return weiToRf(call.args[1]);
    } catch {
      // Not an ERC-20 call; try the next one.
    }
  }
  const m = /^Save ([\d,.]+) RF/.exec(action.label);
  return m ? Number(m[1]!.replace(/,/g, "")) : null;
}

const id = (a: StewardAction) => (a.friend ? `#${a.friend.tokenId}` : "");

/** CARE row label: verb + id, so the cost column always has room. */
export function careLabel(action: StewardAction): string {
  switch (action.kind) {
    case "claim":
      return isNegligible(action) ? `FEED ${id(action)} · TINY` : `FEED ${id(action)}`;
    case "train":
      return `TRAIN ${id(action)}`;
    case "raise":
      return `RAISE ${id(action)}`;
    case "wake":
      return `WAKE ${id(action)}`;
    case "hatch": {
      const egg = eggIdOf(action);
      return egg ? `HATCH #${egg}` : "HATCH EGG";
    }
    case "save": {
      const rf = savedRfOf(action);
      return rf === null ? "SAVE RF" : `SAVE ${compact(rf)} RF`;
    }
    case "withdraw":
      return `WITHDRAW ${id(action)}`;
    default:
      return action.label.toUpperCase();
  }
}

/** CARE cost column: "113K RF", "FREE", or nothing when the label already says TINY. */
export function careCost(action: StewardAction): string {
  if (action.costRf > 0) return `${compact(action.costRf)} RF`;
  return isNegligible(action) ? "" : "FREE";
}

/** Truncates a label to `cols`, marking the cut with a single "~". */
export function squeezeLabel(label: string, cols: number): string {
  if (label.length <= cols) return label;
  return `${label.slice(0, Math.max(0, cols - 1)).trimEnd()}~`;
}

/** Two header lines for CONFIRM: what, then the target ("TRAIN #1969", "→ TIER 3"). */
export function confirmHeader(action: StewardAction): [string, string] {
  const f = action.friend;
  const arrow = "→";
  switch (action.kind) {
    case "claim": {
      if (isNegligible(action)) return [`FEED ${id(action)}`, `${arrow} TINY · NOT WORTH GAS`];
      const rf = f ? weiToRf(f.rewards.earnedRf) : 0;
      const weth = f ? weiToRf(f.rewards.earnedWeth) : 0;
      // "→ 36.5K RF + WETH": what moves into the Friend's wallet (the rationale says where).
      const parts = [rf > 0 ? `${compact(rf)} RF` : "", weth > 0 ? (rf > 0 ? "WETH" : `${compact(weth)} WETH`) : ""].filter(Boolean);
      return [`FEED ${id(action)}`, `${arrow} ${parts.join(" + ") || "REWARDS"}`];
    }
    case "train":
      return [`TRAIN ${id(action)}`, `${arrow} TIER ${f ? f.position.tier + 1 : "?"}`];
    case "raise": {
      const gen = f ? f.generation - 1 : null;
      const resets = f && f.position.tier > 0 ? " · TIER RESETS" : "";
      return [`RAISE ${id(action)}`, `${arrow} GEN ${gen ?? "?"}${resets}`];
    }
    case "wake":
      return [`WAKE ${id(action)}`, `${arrow} AWAKE · +${compact(action.deltaWeight)} WEIGHT`];
    case "hatch": {
      const egg = eggIdOf(action);
      return [egg ? `HATCH EGG #${egg}` : "HATCH EGG", `${arrow} GEN-${action.hatchGeneration ?? "?"} ${compact(action.costRf)} RF`];
    }
    case "save": {
      const rf = savedRfOf(action);
      return [rf === null ? "SAVE RF" : `SAVE ${compact(rf)} RF`, `${arrow} ${id(action)} WALLET`];
    }
    case "withdraw":
      return [`WITHDRAW ${id(action)}`, `${arrow} OWNER WALLET`];
    default:
      return [action.label.toUpperCase(), ""];
  }
}

/** The sentence CONFIRM explains the action with; a negligible claim says so. */
export function confirmRationale(action: StewardAction): string {
  if (isNegligible(action)) return "Not worth gas yet: rewards below the gas to claim them.";
  return firstSentence(action.rationale);
}

/**
 * Raise of a trained Friend: the tier resets and the RF paid in upgrades is lost. Core's
 * rationale says so in its second sentence, which `confirmRationale` drops, so CONFIRM prints
 * the figure (core `upgradesPaidRf`) on two rows of at most `cols`:
 * "TIER RESETS · 50 RF OF" / "UPGRADES NOT REFUNDED". Null for anything else.
 */
export function notRefundedLines(action: StewardAction, cols = 23): [string, string] | null {
  const f = action.friend;
  if (action.kind !== "raise" || !f || f.collection !== "Generations" || f.position.tier <= 0) return null;
  const paid = compact(upgradesPaidRf(f.generation, f.position.tier));
  const first = `TIER RESETS · ${paid} RF OF`;
  return [first.length <= cols ? first : `TIER RESETS · ${paid} RF`, "UPGRADES NOT REFUNDED"];
}

/** The conclusion of core's rationale ("cheap for what it adds") when it fits one row, else null. */
export function shortConclusion(action: StewardAction, cols = 23): string | null {
  const m = /:\s*(.+?)[.!]?$/.exec(firstSentence(action.rationale));
  const clause = m?.[1]?.replace(/\s*\([^)]*\)/g, "").trim();
  if (!clause || clause.length > cols) return null;
  return clause.charAt(0).toUpperCase() + clause.slice(1);
}
