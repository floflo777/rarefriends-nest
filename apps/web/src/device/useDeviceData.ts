/** Loads everything a device needs from a `NestDataSource`; components never read the chain themselves. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import type { Collection, Friend, Household, ProtocolState, Snapshot, Sprite } from "@nest/core";
import { MIN_POLL_MS } from "../data/live.js";
import { SourceError, friendKey, type NestDataSource } from "../data/source.js";
import type { StatusLine } from "../screens/render.js";

export type DeviceTarget = { kind: "household"; owner: Address } | { kind: "friend"; collection: Collection; tokenId: bigint } | { kind: "none" };

export interface DeviceData {
  protocol: ProtocolState | null;
  household: Household | null;
  snapshot: Snapshot | null;
  sprites: Record<string, Sprite>;
  status: { household?: StatusLine; protocol?: StatusLine; snapshot?: StatusLine };
  loading: boolean;
  /** Increments on every completed load; effects that depend on fresh data key on it. */
  generation: number;
  refresh: () => void;
}

/** Default background refresh; never below the RPC-friendly minimum. */
export const DEFAULT_POLL_MS = 30_000;

function statusOf(e: unknown): StatusLine {
  if (e instanceof SourceError) return { code: e.code, message: e.message };
  return { message: e instanceof Error ? e.message : String(e) };
}

/** A single Friend viewed as a one-member household (visitor mode). */
export function householdOfFriend(friend: Friend): Household {
  return { owner: friend.owner, friends: [friend], eggTokenId: null, rfBalance: 0n, rfAllowance: 0n };
}

export function useDeviceData(source: NestDataSource, target: DeviceTarget, pollMs: number = DEFAULT_POLL_MS): DeviceData {
  const [protocol, setProtocol] = useState<ProtocolState | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [sprites, setSprites] = useState<Record<string, Sprite>>({});
  const [status, setStatus] = useState<DeviceData["status"]>({});
  const [loading, setLoading] = useState(true);
  const [requested, setRequested] = useState(0);
  const [generation, setGeneration] = useState(0);
  const alive = useRef(true);
  const spriteCache = useRef<Record<string, Sprite>>({});

  const refresh = useCallback(() => setRequested((g) => g + 1), []);

  const targetKey = target.kind === "household" ? `h:${target.owner}` : target.kind === "friend" ? friendKey(target.collection, target.tokenId) : "none";

  useEffect(() => {
    alive.current = true;
    setLoading(true);
    const next: DeviceData["status"] = {};

    const loadHousehold = async (): Promise<Household | null> => {
      if (target.kind === "household") return source.household(target.owner);
      if (target.kind === "friend") return householdOfFriend(await source.friend(target.collection, target.tokenId));
      return null;
    };

    void (async () => {
      const [p, h, s] = await Promise.allSettled([source.protocolState(), loadHousehold(), source.snapshot()]);
      if (!alive.current) return;
      if (p.status === "fulfilled") setProtocol(p.value);
      else next.protocol = statusOf(p.reason);
      if (s.status === "fulfilled") setSnapshot(s.value);
      else next.snapshot = statusOf(s.reason);
      if (h.status === "fulfilled") {
        setHousehold(h.value);
        if (h.value) {
          // Sprites never change: only fetch the ones this hook has not seen.
          const missing = h.value.friends.filter((f) => spriteCache.current[friendKey(f.collection, f.tokenId)] === undefined);
          const entries = await Promise.allSettled(missing.map(async (f) => [friendKey(f.collection, f.tokenId), await source.sprite(f)] as const));
          if (!alive.current) return;
          for (const e of entries) if (e.status === "fulfilled") spriteCache.current[e.value[0]] = e.value[1];
          setSprites({ ...spriteCache.current });
        }
      } else {
        setHousehold(null);
        next.household = statusOf(h.reason);
      }
      setStatus(next);
      setLoading(false);
      setGeneration((g) => g + 1);
    })();

    return () => {
      alive.current = false;
    };
    // targetKey captures the target's identity; source is stable per route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, targetKey, requested]);

  // Background refresh while the tab is visible, never faster than the RPC allows.
  useEffect(() => {
    const every = Math.max(MIN_POLL_MS, pollMs);
    const t = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") refresh();
    }, every);
    return () => clearInterval(t);
  }, [pollMs, refresh]);

  return { protocol, household, snapshot, sprites, status, loading, generation, refresh };
}
