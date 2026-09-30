/**
 * Shareable pet card: a 1200x630 PNG drawn on a canvas, with a Download button. Left, side by
 * side: the Friend's on-chain sprite (registry frame 0) and its official tokenURI scene, drawn
 * as the image the contract returns (never redrawn or re-coloured, only scaled to fit).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { FRAME_SIZE, frameToRows, streamShare, weiToRf, type Friend, type PetFrame, type ProtocolState, type Snapshot } from "@nest/core";
import { useDataSource } from "../data/context.jsx";
import { deepLink } from "../deepLink.js";
import { createMockSource } from "../data/mock.js";
import { collectionFromSlug, parseTokenId, type NestDataSource } from "../data/source.js";
import { grouped, percent } from "../model/format.js";
import { identityOf } from "../model/pet.js";

const W = 1200;
const H = 630;
const BG = "#c5d8a4";
const FG = "#31401f";
const MONO = "ui-monospace, Menlo, Consolas, monospace";

export interface CardData {
  friend: Friend;
  frame: PetFrame | null;
  /** The tokenURI image, decoded and ready to draw; null when the scene could not be read. */
  scene: CanvasImageSource | null;
  protocol: ProtocolState | null;
  snapshot: Snapshot | null;
}

export function drawCard(ctx: CanvasRenderingContext2D, d: CardData): void {
  const { friend } = d;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = FG;
  ctx.fillRect(0, 0, W, 14);
  ctx.fillRect(0, H - 14, W, 14);

  // Sprite (16x16 at x13) and the on-chain scene, two 220 px panels side by side.
  const box = 220;
  const top = (H - box) / 2 - 20;
  const spriteX = 40;
  const sceneX = spriteX + box + 24;
  ctx.strokeStyle = FG;
  ctx.lineWidth = 6;
  ctx.strokeRect(spriteX, top, box, box);
  ctx.strokeRect(sceneX, top, box, box);
  const scale = Math.floor((box - 12) / FRAME_SIZE);
  const inset = (box - FRAME_SIZE * scale) / 2;
  if (d.frame) {
    frameToRows(d.frame).forEach((rows, y) => rows.forEach((on, x) => on && ctx.fillRect(spriteX + inset + x * scale, top + inset + y * scale, scale, scale)));
  }
  if (d.scene) {
    const { width: iw, height: ih } = sceneSize(d.scene);
    const fitScale = Math.min((box - 6) / iw, (box - 6) / ih);
    const w = iw * fitScale;
    const h = ih * fitScale;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(d.scene, sceneX + (box - w) / 2, top + (box - h) / 2, w, h);
    ctx.imageSmoothingEnabled = true;
  } else {
    ctx.font = `20px ${MONO}`;
    ctx.textBaseline = "middle";
    ctx.fillText("scene unavailable", sceneX + 14, top + box / 2);
  }
  ctx.font = `20px ${MONO}`;
  ctx.textBaseline = "top";
  ctx.fillText("on-chain sprite", spriteX, top + box + 14);
  ctx.fillText("tokenURI scene", sceneX, top + box + 14);

  const tx = 540;
  ctx.textBaseline = "top";
  const identity = identityOf(friend);
  ctx.textBaseline = "top";
  ctx.font = `bold 84px ${MONO}`;
  ctx.fillText(identity.name, tx, 70);
  ctx.font = `34px ${MONO}`;
  const gen = friend.collection === "Genesis" ? "Genesis" : `Generation ${friend.generation}`;
  const family = identity.familyLabel.charAt(0) + identity.familyLabel.slice(1).toLowerCase();
  ctx.fillText(friend.collection === "Genesis" ? "Genesis, no family" : `${family} family`, tx, 175);
  ctx.fillText(`${gen}  ·  Tier ${friend.position.tier}`, tx, 222);

  ctx.font = `30px ${MONO}`;
  const share = d.protocol ? streamShare(friend, d.protocol) : null;
  ctx.fillText(`Weight share  ${share === null ? "-" : percent(share)}`, tx, 292);
  ctx.fillText(`Unclaimed  ${grouped(weiToRf(friend.rewards.earnedRf))} RF  ·  ${weiToRf(friend.rewards.earnedWeth).toFixed(4)} WETH`, tx, 336);
  const rank = d.snapshot?.leaderboard.find((r) => r.owner.toLowerCase() === friend.owner.toLowerCase());
  ctx.fillText(`Household burned  ${rank ? `${grouped(rank.burnedRf)} RF` : "not ranked yet"}`, tx, 380);

  ctx.font = `21px ${MONO}`;
  ctx.fillText(`wallet ${friend.wallet}`, tx, 460);
  ctx.fillText(`owner  ${friend.owner}`, tx, 492);
  ctx.font = `28px ${MONO}`;
  ctx.fillText("nest · rarefriends", tx, 560);
}

function sceneSize(img: CanvasImageSource): { width: number; height: number } {
  const el = img as { naturalWidth?: number; naturalHeight?: number; width?: unknown; height?: unknown };
  const width = el.naturalWidth || (typeof el.width === "number" ? el.width : 0) || 1;
  const height = el.naturalHeight || (typeof el.height === "number" ? el.height : 0) || 1;
  return { width, height };
}

/** Decodes the tokenURI still image (never the animation) exactly as the contract returned it. */
async function loadScene(source: NestDataSource, friend: Friend): Promise<HTMLImageElement | null> {
  if (!source.scene) return null;
  const scene = await source.scene(friend);
  const src = scene.imageDataUrl ?? (scene.animationDataUrl?.startsWith("data:image/") ? scene.animationDataUrl : null);
  if (!src) return null;
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  await img.decode();
  return img;
}

export function CardPage() {
  const { collection: slug, tokenId: rawId } = useParams();
  const [search] = useSearchParams();
  const routeSource = useDataSource();
  const source: NestDataSource = useMemo(() => (search.has("demo") ? createMockSource() : routeSource), [search, routeSource]);
  const collection = collectionFromSlug(slug);
  const tokenId = parseTokenId(rawId);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<CardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!collection || tokenId === null) return;
    let alive = true;
    void (async () => {
      try {
        const friend = await source.friend(collection, tokenId);
        const [sprite, protocol, snapshot, scene] = await Promise.allSettled([source.sprite(friend), source.protocolState(), source.snapshot(), loadScene(source, friend)]);
        if (!alive) return;
        setData({
          friend,
          frame: sprite.status === "fulfilled" ? (sprite.value.idle[0] ?? null) : null,
          scene: scene.status === "fulfilled" ? scene.value : null,
          protocol: protocol.status === "fulfilled" ? protocol.value : null,
          snapshot: snapshot.status === "fulfilled" ? snapshot.value : null,
        });
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [source, collection, tokenId]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !data) return;
    drawCard(ctx, data);
  }, [data]);

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nest-${slug}-${rawId}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  };

  if (!collection || tokenId === null) {
    return (
      <main className="page">
        <p className="error">Unknown Friend.</p>
        <Link to="/">Home</Link>
      </main>
    );
  }

  return (
    <main className="page card-page">
      <canvas ref={canvasRef} className="card" width={W} height={H} role="img" aria-label={`Pet card for ${slug} ${rawId}`} data-ready={data ? "true" : "false"} data-scene={data?.scene ? "true" : "false"} />
      {error && <p className="error">{error}</p>}
      <nav className="under">
        <button type="button" className="primary" onClick={download} disabled={!data}>
          Download PNG
        </button>
        <Link to={deepLink(search.has("demo") ? "/demo" : `/pet/${slug}/${rawId}`)}>Back</Link>
      </nav>
    </main>
  );
}
