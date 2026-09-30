/**
 * What the screens read from the indexer snapshot beyond the leaderboard: index coverage
 * (which blocks the burn attribution actually covers), the unknown-selector share and the
 * highest hardwired id. Both optional blocks are absent in snapshots written by older indexers.
 */
import type { Snapshot } from "@nest/core";

export type SnapshotCoverage = NonNullable<Snapshot["coverage"]>;

/** The indexer's coverage block, or null when the snapshot was written without one. */
export function coverageOf(snapshot: Snapshot): SnapshotCoverage | null {
  return snapshot.coverage ?? null;
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
export function maxHardwiredId(snapshot: Snapshot): bigint | null {
  const max = snapshot.hardwired.maxTokenId;
  return max !== undefined && Number.isInteger(max) && max > 0 ? BigInt(max) : null;
}
