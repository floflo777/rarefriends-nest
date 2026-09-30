/**
 * Wallet-mode run of a confirmed Steward action: dry-run first, then sign each prepared
 * transaction in order. Pure state; the device drives the async work and feeds phases in.
 *
 *   simulating -> ready (● signs) | rejected (● back)
 *   ready -> signing[i] -> pending[i] -> ... -> done (● back) | failed (● back)
 */
import type { Hex } from "viem";
import type { DryRunResult, StewardAction } from "@nest/core";
import type { Input } from "./machine.js";

export type RunPhase =
  | { phase: "simulating" }
  | { phase: "ready"; gas: bigint }
  | { phase: "rejected"; reason: string }
  | { phase: "signing"; index: number; total: number; description: string }
  | { phase: "pending"; index: number; total: number; hash: Hex }
  | { phase: "done"; hashes: Hex[] }
  | { phase: "failed"; message: string; hashes: Hex[] };

export interface RunState {
  action: StewardAction;
  phase: RunPhase;
}

export type RunCommand = "sign" | "dismiss" | "refresh-and-dismiss";

/** What a button press means while a run is on screen; null ignores the press. */
export function runInput(run: RunState, input: Input): RunCommand | null {
  switch (run.phase.phase) {
    case "ready":
      return input === "ok" ? "sign" : "dismiss";
    case "rejected":
      return input === "ok" ? "dismiss" : null;
    case "done":
      return input === "ok" ? "refresh-and-dismiss" : null;
    case "failed":
      return input === "ok" ? (run.phase.hashes.length > 0 ? "refresh-and-dismiss" : "dismiss") : null;
    default:
      return null;
  }
}

/** Folds dry-run results into the phase that follows SIMULATING. */
export function phaseAfterDryRun(results: readonly DryRunResult[]): RunPhase {
  const failed = results.find((r) => !r.ok);
  if (failed) return { phase: "rejected", reason: failed.revertReason ?? failed.revertSelector ?? "reverted" };
  if (results.length === 0) return { phase: "rejected", reason: "nothing to send" };
  return { phase: "ready", gas: results.reduce((sum, r) => sum + (r.gas ?? 0n), 0n) };
}
