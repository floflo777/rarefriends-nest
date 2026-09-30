/**
 * Wallet-mode run of a confirmed Steward action: dry-run first, then sign each prepared
 * transaction in order. Pure state; the device drives the async work and feeds phases in.
 *
 *   simulating -> ready (● signs) | rejected (● back)
 *   ready -> signing[i] -> pending[i] -> ... -> done (● back) | failed (● back)
 */
import type { Address, Hex } from "viem";
import { dryRunAll, type DryRunResult, type NestClient, type StewardAction } from "@nest/core";
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

/*
 * Demo-mode run of a confirmed action. The demo never signs anything, but it does the same
 * dry-run as wallet mode against the live RPC (eth_simulateV1 through core `dryRunAll`), from
 * the real owner of the Friend the action targets, and only then applies the local mutation:
 *
 *   YES -> simulating -> DRY-RUN OK · GAS N · NOT SENT (DEMO)  -> mutation applied
 *                     -> WOULD REVERT · <decoded reason>       -> no mutation
 *                     -> RPC UNAVAILABLE · LOCAL SIM            -> mutation applied
 *
 * Wallet mode above is untouched; the Device shows these lines in its SIMULATED toast.
 */

export type DemoVerdict = { kind: "ok"; gas: bigint } | { kind: "revert"; reason: string } | { kind: "unavailable"; reason: string };

export type DemoPhase = { phase: "simulating"; from: Address } | { phase: "done"; verdict: DemoVerdict; line: string; applied: boolean };

export interface DemoRunDeps {
  /** Read-only client for the dry-run; nothing is ever sent through it. */
  client: NestClient;
  /** Owner of the demo household: `from` for household actions (hatch, save). */
  owner: Address;
  /** Applies the action to the mock and returns its one-line description. */
  simulate: (action: StewardAction) => string;
  onPhase?: (phase: DemoPhase) => void;
}

export interface DemoRunResult {
  verdict: DemoVerdict;
  /** The toast line (the Device prefixes it with `SIMULATED:`). */
  line: string;
  applied: boolean;
}

export const DEMO_NOT_SENT = "NOT SENT (DEMO)";

/** The address the dry-run runs from: the real owner of the targeted Friend, else the household owner. */
export function demoSender(action: StewardAction, owner: Address): Address {
  return action.friend?.owner ?? owner;
}

/** Error name without its arguments: `ERC20InsufficientBalance(0x…, 1, 2)` -> `ERC20InsufficientBalance`. */
function revertName(reason: string): string {
  const m = /^([A-Za-z0-9_]+)\(/.exec(reason);
  return m?.[1] ?? reason;
}

/**
 * Folds dry-run results into a verdict. A failure with decoded revert data (or a revert message)
 * is a real revert; any other failure means the RPC could not answer.
 */
export function demoVerdict(results: readonly DryRunResult[]): DemoVerdict {
  const failed = results.find((r) => !r.ok);
  if (!failed) return { kind: "ok", gas: results.reduce((sum, r) => sum + (r.gas ?? 0n), 0n) };
  const reason = failed.revertReason ?? failed.revertSelector ?? "reverted";
  if (failed.revertSelector !== undefined || /revert/i.test(reason)) return { kind: "revert", reason };
  return { kind: "unavailable", reason };
}

export function demoLine(verdict: DemoVerdict, mutation: string | null): string {
  switch (verdict.kind) {
    case "ok":
      return `DRY-RUN OK · GAS ${Number(verdict.gas).toLocaleString("en-US")} · ${DEMO_NOT_SENT}${mutation ? ` · ${mutation}` : ""}`;
    case "revert":
      return `WOULD REVERT · ${revertName(verdict.reason)} · ${DEMO_NOT_SENT}`;
    case "unavailable":
      return `RPC UNAVAILABLE · LOCAL SIM${mutation ? ` · ${mutation}` : ""}`;
  }
}

/** Dry-runs on chain, then applies the local mutation unless the chain says the action would revert. */
export async function runDemo(action: StewardAction, deps: DemoRunDeps): Promise<DemoRunResult> {
  const from = demoSender(action, deps.owner);
  deps.onPhase?.({ phase: "simulating", from });
  let verdict: DemoVerdict;
  try {
    verdict = demoVerdict(await dryRunAll(deps.client, from, action.txs));
  } catch (error) {
    verdict = { kind: "unavailable", reason: error instanceof Error ? error.message : String(error) };
  }
  const applied = verdict.kind !== "revert";
  const line = demoLine(verdict, applied ? deps.simulate(action) : null);
  deps.onPhase?.({ phase: "done", verdict, line, applied });
  return { verdict, line, applied };
}
