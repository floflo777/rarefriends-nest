/**
 * The Friend's official on-chain scene: `tokenURI` decoded to name, description and the
 * image / animation data URLs, exactly as the contract returns them (never re-encoded).
 * One in-memory cache per token for the session.
 */
import type { Collection, NestClient } from "@nest/core";
import { ADDRESSES, GENERATIONS_ABI, GENESIS_ABI } from "@nest/core";

export interface TokenScene {
  name: string;
  description: string;
  /** Usually an SVG data URL; kept verbatim. */
  imageDataUrl: string | null;
  animationDataUrl: string | null;
}

function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Parses the JSON document behind a tokenURI (data: URL, plain JSON, or a fetched URL). */
export async function tokenUriToJson(uri: string): Promise<unknown> {
  const trimmed = uri.trim();
  const m = /^data:([^,]*?)(;base64)?,(.*)$/s.exec(trimmed);
  if (m) {
    const payload = m[3] ?? "";
    const textOf = m[2] ? decodeBase64Utf8(payload) : decodeURIComponent(payload);
    return JSON.parse(textOf) as unknown;
  }
  if (trimmed.startsWith("{")) return JSON.parse(trimmed) as unknown;
  if (/^https?:\/\//.test(trimmed)) {
    const res = await fetch(trimmed);
    if (!res.ok) throw new Error(`tokenURI fetch failed (HTTP ${res.status})`);
    return (await res.json()) as unknown;
  }
  throw new Error("tokenURI is not a data: URL, JSON or http(s) URL");
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function sceneFromMetadata(meta: unknown): TokenScene {
  const o = (typeof meta === "object" && meta !== null ? meta : {}) as Record<string, unknown>;
  return {
    name: str(o["name"]) ?? "",
    description: str(o["description"]) ?? "",
    imageDataUrl: str(o["image"]) ?? str(o["image_data"]) ?? null,
    animationDataUrl: str(o["animation_url"]) ?? null,
  };
}

// TODO(core): replace with core's `readTokenMetadata(client, collection, id)` returning
// { name, description, imageDataUrl, animationDataUrl } once it is exported.
export async function readTokenMetadata(client: NestClient, collection: Collection, tokenId: bigint): Promise<TokenScene> {
  const uri =
    collection === "Generations"
      ? await client.readContract({ address: ADDRESSES.generations, abi: GENERATIONS_ABI, functionName: "tokenURI", args: [tokenId] })
      : await client.readContract({ address: ADDRESSES.genesis, abi: GENESIS_ABI, functionName: "tokenURI", args: [tokenId] });
  return sceneFromMetadata(await tokenUriToJson(uri));
}

const cache = new Map<string, Promise<TokenScene>>();

/** Memoises a scene read per token for the session; a failed read is retried next time. */
export function cachedScene(key: string, load: () => Promise<TokenScene>): Promise<TokenScene> {
  let p = cache.get(key);
  if (!p) {
    p = load();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/** Tests only. */
export function clearSceneCache(): void {
  cache.clear();
}

/** Which URL to show: stills under reduced motion, else the animation when there is one. */
export function sceneSource(scene: TokenScene, reducedMotion: boolean): string | null {
  if (reducedMotion) return scene.imageDataUrl ?? scene.animationDataUrl;
  return scene.animationDataUrl ?? scene.imageDataUrl;
}
