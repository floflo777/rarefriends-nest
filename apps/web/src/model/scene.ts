/**
 * The Friend's official on-chain scene: `tokenURI` decoded by core (`readTokenMetadata`) to
 * name, description and the image / animation data URLs, exactly as the contract returns
 * them (never re-encoded). One in-memory cache per token for the session.
 */
import type { TokenMetadata } from "@nest/core";

/** What the HOME screen shows: core's decoded tokenURI metadata. */
export type TokenScene = TokenMetadata;

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
