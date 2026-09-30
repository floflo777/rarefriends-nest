/**
 * The CARE menu: core's Steward plan for the whole household, narrowed to the selected
 * Friend's own actions plus the household-level Hatch and Save. Nothing is computed here;
 * costs, burns, weights and rationales are the planner's.
 */
import type { Eligibility, Friend, Household, ProtocolState, StewardAction } from "@nest/core";
import { planHousehold } from "@nest/core";
import { sameFriend } from "../data/source.js";

export const HOUSEHOLD_KINDS: ReadonlySet<StewardAction["kind"]> = new Set(["hatch", "save"]);

export interface CareItem {
  action: StewardAction;
  /** False when the ownership gate (or read-only mode) forbids running it. */
  enabled: boolean;
  /** Why it is disabled, for the CONFIRM screen. */
  reason?: string;
}

/** Actions for `pet` in planner order (claims first, then by break-even), then Hatch, then Save. */
export function careMenu(plan: readonly StewardAction[], pet: Friend | null): StewardAction[] {
  const own = pet ? plan.filter((a) => !HOUSEHOLD_KINDS.has(a.kind) && a.friend !== undefined && sameFriend(a.friend, pet)) : [];
  const household = ["hatch", "save"].flatMap((kind) => plan.filter((a) => a.kind === kind));
  return [...own, ...household];
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
