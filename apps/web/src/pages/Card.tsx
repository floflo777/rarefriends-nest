/** Shareable pet card: a 1200x630 PNG drawn on a canvas, with a Download button. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { Friend, PetFrame, ProtocolState, Snapshot } from "@nest/core";
import { useDataSource } from "../data/context.jsx";
import { createMockSource } from "../data/mock.js";
import { collectionFromSlug, parseTokenId, type NestDataSource } from "../data/source.js";
import { framePixel, FRAME_SIZE } from "../lcd/sprite.js";
import { percent, shortAddress, toUnits } from "../model/format.js";
import { petName } from "../model/vitals.js";

const W = 1200;
const H = 630;
const BG = "#c5d8a4";
const FG = "#31401f";

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
    for (let y = 0; y < FRAME_SIZE; y++) for (let x = 0; x < FRAME_SIZE; x++) if (framePixel(d.frame, x, y)) ctx.fillRect(sx + x * scale, sy + y * scale, scale, scale);
  }

  const tx = 540;
  ctx.font = "bold 84px ui-monospace, Menlo, Consolas, monospace";
  ctx.textBaseline = "top";
  ctx.fillText(petName(friend), tx, 90);
  ctx.font = "40px ui-monospace, Menlo, Consolas, monospace";
  const gen = friend.collection === "Genesis" ? "Genesis" : `Generation ${friend.generation}`;
  ctx.fillText(`${gen}  ·  Tier ${friend.position.tier}`, tx, 200);
  if (friend.familyName) ctx.fillText(`Family ${friend.familyName}`, tx, 256);

  const share = d.protocol && toUnits(d.protocol.totalWeight) > 0 ? toUnits(friend.position.weight) / toUnits(d.protocol.totalWeight) : null;
  ctx.fillText(`Weight share  ${share === null ? "-" : percent(share)}`, tx, 330);
  const burned = d.snapshot?.leaderboard.find((r) => r.owner.toLowerCase() === friend.owner.toLowerCase())?.burnedRf ?? 0;
  ctx.fillText(`Household burned  ${Math.round(burned).toLocaleString("en-US")} RF`, tx, 386);

  ctx.font = "30px ui-monospace, Menlo, Consolas, monospace";
  ctx.fillText(friend.owner, tx, 480);
  ctx.font = "28px ui-monospace, Menlo, Consolas, monospace";
  ctx.fillText("NEST  ·  Rare Friends on Robinhood Chain", tx, 550);
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
        if (!friend) throw new Error("Friend not found");
        const [frames, protocol, snapshot] = await Promise.allSettled([source.sprite(friend), source.protocolState(), source.snapshot()]);
        if (!alive) return;
        setData({
          friend,
          frame: frames.status === "fulfilled" ? (frames.value[0] ?? null) : null,
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
      <canvas ref={canvasRef} className="card" width={W} height={H} role="img" aria-label={`Pet card for ${slug} ${rawId}`} />
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
