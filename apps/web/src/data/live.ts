/**
 * Live data source. Chain reads are provided by packages/core (in progress); until
 * that module exports its readers, every chain method rejects with a clear message
 * and the LCD shows it. `snapshot()` is already real: it fetches the indexer output
 * written to public/data/snapshot.json.
 */
import type { Snapshot } from "@nest/core";
import type { NestDataSource } from "./source.js";

export const LIVE_NOT_WIRED = "Live chain reads are not wired yet (packages/core pending)";

export function snapshotUrl(): string {
  return `${import.meta.env.BASE_URL}data/snapshot.json`;
}

export function createLiveSource(): NestDataSource {
  const pending = <T>(): Promise<T> => Promise.reject(new Error(LIVE_NOT_WIRED));
  return {
    protocolState: () => pending(),
    friend: () => pending(),
    household: () => pending(),
    sprite: () => pending(),
    async snapshot(): Promise<Snapshot> {
      const res = await fetch(snapshotUrl(), { cache: "no-cache" });
      if (!res.ok) throw new Error(`snapshot.json: HTTP ${res.status}`);
      return (await res.json()) as Snapshot;
    },
  };
}
