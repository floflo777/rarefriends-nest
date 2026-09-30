/** Shareable pet card: a 1200x630 PNG drawn on a canvas, with a Download button. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { FRAME_SIZE, frameToRows, streamShare, weiToRf, type Friend, type PetFrame, type ProtocolState, type Snapshot } from "@nest/core";
import { useDataSource } from "../data/context.jsx";
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

  // Sprite, 16x16 at x24.
  const scale = 24;
  const sx = 80;
  const sy = (H - FRAME_SIZE * scale) / 2;
  ctx.strokeStyle = FG;
  ctx.lineWidth = 6;
  ctx.strokeRect(sx - 20, sy - 20, FRAME_SIZE * scale + 40, FRAME_SIZE * scale + 40);
  if (d.frame) {
    frameToRows(d.frame).forEach((rows, y) => rows.forEach((on, x) => on && ctx.fillRect(sx + x * scale, sy + y * scale, scale, scale)));
  }

  const tx = 540;
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
        const [sprite, protocol, snapshot] = await Promise.allSettled([source.sprite(friend), source.protocolState(), source.snapshot()]);
        if (!alive) return;
        setData({
          friend,
          frame: sprite.status === "fulfilled" ? (sprite.value.idle[0] ?? null) : null,
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
      <canvas ref={canvasRef} className="card" width={W} height={H} role="img" aria-label={`Pet card for ${slug} ${rawId}`} data-ready={data ? "true" : "false"} />
      {error && <p className="error">{error}</p>}
      <nav className="under">
        <button type="button" className="primary" onClick={download} disabled={!data}>
          Download PNG
        </button>
        <Link to={search.has("demo") ? "/demo" : `/pet/${slug}/${rawId}`}>Back</Link>
      </nav>
    </main>
  );
}
