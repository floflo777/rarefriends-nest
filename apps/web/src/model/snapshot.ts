/**
 * What the screens read from the indexer snapshot beyond the leaderboard: index coverage
 * (which blocks the burn attribution actually covers), the unknown-selector share and the
 * highest hardwired id. Fields core does not type yet are read through small adapters.
 */
import type { Snapshot } from "@nest/core";

export interface SnapshotCoverage {
  fromBlock: number;
  toBlock: number;
  complete: boolean;
  partial: boolean;
}

// TODO(core): use `Snapshot["coverage"]` once core types the indexer's coverage block.
export function coverageOf(snapshot: Snapshot): SnapshotCoverage | null {
  const c = (snapshot as { coverage?: Partial<SnapshotCoverage> }).coverage;
  if (!c || typeof c.fromBlock !== "number" || typeof c.toBlock !== "number") return null;
  return { fromBlock: c.fromBlock, toBlock: c.toBlock, complete: c.complete === true, partial: c.partial === true || c.complete !== true };
}

/** Block number as the LCD prints it: 64,981,920 -> "65.0M" (one decimal kept on purpose). */
export function blockLabel(block: number): string {
  if (block >= 1e6) return `${(block / 1e6).toFixed(1)}M`;
  if (block >= 1e3) return `${(block / 1e3).toFixed(1)}K`;
  return Math.round(block).toString();
}

/**
 * `SINCE BLK 65.0M`: where the burn attribution starts. Coverage that begins before the
 * protocol's first hardwire (or that the indexer did not write) starts, for the reader, at
 * that first block: nothing existed to index before it.
 */
export function coverageSince(snapshot: Snapshot): string {
  const c = coverageOf(snapshot);
  const first = snapshot.hardwired.firstBlock;
  const from = c === null || c.fromBlock < first ? first : c.fromBlock;
  return `SINCE BLK ${blockLabel(from)}`;
}

/** `FULL INDEX` / `PARTIAL INDEX`; `INDEX ?` when the snapshot does not say. */
export function coverageStatus(snapshot: Snapshot): string {
  const c = coverageOf(snapshot);
  if (!c) return "INDEX ?";
  return c.complete ? "FULL INDEX" : "PARTIAL INDEX";
}

/** Share of indexed burn whose function selector the indexer could not classify. */
export function unknownBurnShare(snapshot: Snapshot): number | null {
  const unknown = snapshot.totals.byAction["unknown"];
  if (!unknown || snapshot.totals.burnedRf <= 0) return null;
  return unknown.burnedRf / snapshot.totals.burnedRf;
}

/**
 * Highest Generations id the census has seen hardwired, or null when the snapshot does
 * not carry it. Any id above it with generation 0 has never been minted: NO SUCH FRIEND.
 */
// TODO(core): read `snapshot.hardwired.maxTokenId` directly once the indexer/core type it.
export function maxHardwiredId(snapshot: Snapshot): bigint | null {
  const h = snapshot.hardwired as { maxTokenId?: number | string; maxId?: number | string; lastTokenId?: number | string };
  const raw = h.maxTokenId ?? h.maxId ?? h.lastTokenId;
  if (raw === undefined || raw === null) return null;
  try {
    const v = BigInt(typeof raw === "number" ? Math.floor(raw) : raw);
    return v > 0n ? v : null;
  } catch {
    return null;
  }
}
