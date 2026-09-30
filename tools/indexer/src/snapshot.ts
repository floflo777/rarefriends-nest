/**
 * Pure aggregation of burn records into the Snapshot shape consumed by the web app. Sums are done in
 * bigint wei and converted to RF numbers (6 decimals) at the end.
 */
import { getAddress } from "viem";
import type { HouseholdRank, Snapshot } from "@nest/core";
import type { IndexedBurn } from "./burns.js";
import type { HardwiredSnapshot } from "./hardwired.js";

/** RF token supply at genesis, RF units (design.md). */
export const INITIAL_RF_SUPPLY_RF = 1_024_000_000;

export type Coverage = NonNullable<Snapshot["coverage"]>;
export type ViaNestTotals = NonNullable<Snapshot["totals"]["viaNest"]>;
export type SnapshotTotals = Snapshot["totals"] & { viaNest: ViaNestTotals };
export type RankedHousehold = HouseholdRank & { viaNestRf: number };

/** The published file: the core Snapshot with every optional field present. */
export interface SnapshotFile extends Snapshot {
  totals: SnapshotTotals;
  leaderboard: RankedHousehold[];
  hardwired: HardwiredSnapshot;
  coverage: Coverage;
}

/** wei -> RF as a number with micro-RF precision (exact for any realistic amount). */
export function weiToRf(wei: bigint): number {
  return Number(wei / 1_000_000_000_000n) / 1e6;
}

/** UTC calendar day of a unix timestamp, YYYY-MM-DD. */
export function dayOf(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

export function buildTotals(records: readonly IndexedBurn[]): SnapshotTotals {
  let burned = 0n;
  let viaNestBurned = 0n;
  let viaNestEvents = 0;
  const byAction = new Map<string, { count: number; burned: bigint }>();
  for (const r of records) {
    burned += r.burnedRf;
    if (r.viaNest) {
      viaNestBurned += r.burnedRf;
      viaNestEvents++;
    }
    const a = byAction.get(r.action) ?? { count: 0, burned: 0n };
    a.count++;
    a.burned += r.burnedRf;
    byAction.set(r.action, a);
  }
  const out: Snapshot["totals"]["byAction"] = {};
  for (const [action, a] of [...byAction.entries()].sort((x, y) => (x[1].burned > y[1].burned ? -1 : x[1].burned < y[1].burned ? 1 : 0))) {
    out[action] = { count: a.count, burnedRf: weiToRf(a.burned) };
  }
  return { burnedRf: weiToRf(burned), burnEvents: records.length, byAction: out, viaNest: { burnEvents: viaNestEvents, burnedRf: weiToRf(viaNestBurned) } };
}

/** Daily series over UTC days, ascending, only days with at least one event. */
export function buildDaily(records: readonly IndexedBurn[]): Snapshot["daily"] {
  const days = new Map<string, { burned: bigint; events: number }>();
  for (const r of records) {
    const day = dayOf(r.timestamp);
    const d = days.get(day) ?? { burned: 0n, events: 0 };
    d.burned += r.burnedRf;
    d.events++;
    days.set(day, d);
  }
  return [...days.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, d]) => ({ day, burnedRf: weiToRf(d.burned), events: d.events }));
}

/**
 * Households ranked by RF burned. `actions` counts distinct transactions (one action = one tx, whatever
 * the number of burn logs it emitted). Ties: more actions first, then address.
 */
export function buildLeaderboard(records: readonly IndexedBurn[], limit = 100): RankedHousehold[] {
  const households = new Map<string, { owner: string; burned: bigint; viaNest: bigint; txs: Set<string>; lastActionAt: number }>();
  for (const r of records) {
    const key = r.from.toLowerCase();
    const h = households.get(key) ?? { owner: getAddress(r.from), burned: 0n, viaNest: 0n, txs: new Set<string>(), lastActionAt: 0 };
    h.burned += r.burnedRf;
    if (r.viaNest) h.viaNest += r.burnedRf;
    h.txs.add(r.txHash.toLowerCase());
    if (r.timestamp > h.lastActionAt) h.lastActionAt = r.timestamp;
    households.set(key, h);
  }
  return [...households.values()]
    .sort((a, b) => {
      if (a.burned !== b.burned) return a.burned > b.burned ? -1 : 1;
      if (a.txs.size !== b.txs.size) return b.txs.size - a.txs.size;
      return a.owner.localeCompare(b.owner);
    })
    .slice(0, limit)
    .map((h) => ({ owner: getAddress(h.owner), burnedRf: weiToRf(h.burned), actions: h.txs.size, lastActionAt: h.lastActionAt, viaNestRf: weiToRf(h.viaNest) }));
}

export interface SnapshotInput {
  records: readonly IndexedBurn[];
  hardwired: HardwiredSnapshot;
  genesis: Snapshot["genesis"];
  coverage: Coverage;
  blockNumber: number;
  timestamp: number;
  leaderboardSize?: number;
}

export function buildSnapshot(input: SnapshotInput): SnapshotFile {
  return {
    blockNumber: input.blockNumber,
    timestamp: input.timestamp,
    totals: buildTotals(input.records),
    daily: buildDaily(input.records),
    leaderboard: buildLeaderboard(input.records, input.leaderboardSize ?? 100),
    hardwired: input.hardwired,
    genesis: input.genesis,
    coverage: input.coverage,
  };
}
