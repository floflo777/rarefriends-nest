/** Loads everything a device needs from a `NestDataSource`; components never read the chain themselves. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import type { Collection, Friend, Household, PetFrame, ProtocolState, Snapshot } from "@nest/core";
import { friendKey, type NestDataSource } from "../data/source.js";

export type DeviceTarget = { kind: "household"; owner: Address } | { kind: "friend"; collection: Collection; tokenId: bigint } | { kind: "none" };

export interface DeviceData {
  protocol: ProtocolState | null;
  household: Household | null;
  snapshot: Snapshot | null;
  sprites: Record<string, PetFrame[]>;
  status: { household?: string; protocol?: string; snapshot?: string };
  loading: boolean;
  refresh: () => void;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A single Friend viewed as a one-member household (visitor mode). */
export function householdOfFriend(friend: Friend): Household {
  return { owner: friend.owner, friends: [friend], eggTokenId: null, rfBalance: 0n, rfAllowance: 0n };
}

export function useDeviceData(source: NestDataSource, target: DeviceTarget): DeviceData {
  const [protocol, setProtocol] = useState<ProtocolState | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [sprites, setSprites] = useState<Record<string, PetFrame[]>>({});
  const [status, setStatus] = useState<DeviceData["status"]>({});
  const [loading, setLoading] = useState(true);
  const [generation, setGeneration] = useState(0);
  const alive = useRef(true);

  const refresh = useCallback(() => setGeneration((g) => g + 1), []);

  const targetKey = target.kind === "household" ? `h:${target.owner}` : target.kind === "friend" ? friendKey(target.collection, target.tokenId) : "none";

  useEffect(() => {
    alive.current = true;
    setLoading(true);
    const next: DeviceData["status"] = {};

    const loadHousehold = async (): Promise<Household | null> => {
      if (target.kind === "household") return source.household(target.owner);
      if (target.kind === "friend") {
        const f = await source.friend(target.collection, target.tokenId);
        if (!f) throw new Error(`Friend ${target.tokenId} not found on ${target.collection}`);
        return householdOfFriend(f);
      }
      return null;
    };

    void (async () => {
      const [p, h, s] = await Promise.allSettled([source.protocolState(), loadHousehold(), source.snapshot()]);
      if (!alive.current) return;
      if (p.status === "fulfilled") setProtocol(p.value);
      else next.protocol = msg(p.reason);
      if (s.status === "fulfilled") setSnapshot(s.value);
      else next.snapshot = msg(s.reason);
      if (h.status === "fulfilled") {
        setHousehold(h.value);
        if (h.value) {
          const entries = await Promise.allSettled(h.value.friends.map(async (f) => [friendKey(f.collection, f.tokenId), await source.sprite(f)] as const));
          if (!alive.current) return;
          const map: Record<string, PetFrame[]> = {};
          for (const e of entries) if (e.status === "fulfilled") map[e.value[0]] = e.value[1];
          setSprites(map);
        }
      } else {
        setHousehold(null);
        next.household = msg(h.reason);
      }
      setStatus(next);
      setLoading(false);
    })();

    return () => {
      alive.current = false;
    };
    // targetKey captures the target's identity; source is stable per route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, targetKey, generation]);

  return { protocol, household, snapshot, sprites, status, loading, refresh };
}
