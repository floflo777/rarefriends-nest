#!/usr/bin/env node
/**
 * `nest`: the same reads, plans and dry-runs as the handheld, as JSON for agents and judges.
 * Read-only against the public RPC. Never signs, never sends.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Address } from "viem";
import { isAddress } from "viem";
import {
  ADDRESSES, FAMILIES_REGISTRY_ABI, FAMILY_NAMES,
  createNestClient, readProtocolState, readFriend, readHousehold, planHousehold, dryRunAll,
  decodeFrames, frameToAscii, computeVitals, describe, moodState, speechLine, weiToRf,
  type Collection, type Friend, type ProtocolState, type StewardAction, type Snapshot,
} from "@nest/core";

const HELP = `nest — Rare Friends Nest command line (read-only, dry-run only)

  nest state <gen|genesis> <tokenId> [--json]     one Friend: identity, position, rewards, savings, vitals, personality, sprite
  nest household <address> [--json]               every Friend the wallet owns, plus the egg and RF balance
  nest plan <address> [--dry-run] [--json]        Steward plan ranked by break-even; --dry-run simulates each tx from the owner
  nest census [--json]                            live protocol state and the indexed snapshot (burns, ranks, censuses)
  nest dryrun-doc <address>...                    Markdown table of dry-run results for docs/dry-run.md

Options: --rpc <url> (default ${"https://rpc.mainnet.chain.robinhood.com"}), --json
`;

function json(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}

function parseCollection(s: string | undefined): Collection {
  if (s === "gen" || s === "generations") return "Generations";
  if (s === "genesis") return "Genesis";
  throw new Error(`collection must be gen or genesis, got ${s ?? "nothing"}`);
}

function parseAddress(s: string | undefined): Address {
  if (!s || !isAddress(s)) throw new Error(`expected an address, got ${s ?? "nothing"}`);
  return s;
}

const rf = (wei: bigint) => weiToRf(wei).toLocaleString("en-US", { maximumFractionDigits: 4 });

async function spriteAscii(client: ReturnType<typeof createNestClient>, friend: Friend): Promise<string | null> {
  if (friend.family === undefined || friend.seed === undefined) return null;
  const words = await client.readContract({ address: ADDRESSES.familiesRegistry, abi: FAMILIES_REGISTRY_ABI, functionName: "frames", args: [friend.family, friend.seed] });
  const sprite = decodeFrames(words as readonly bigint[]);
  const first = sprite.idle[0];
  return first ? frameToAscii(first) : null;
}

function describeFriend(friend: Friend, state: ProtocolState, now: number) {
  const vitals = computeVitals(friend, state, now);
  const personality = friend.collection === "Generations" ? describe(friend) : null;
  const mood = personality ? moodState(vitals, personality, now) : "content";
  const line = personality ? speechLine(personality, mood, vitals, now) : "";
  return { vitals, personality, mood, line };
}

function printFriend(friend: Friend, state: ProtocolState, ascii: string | null, now: number): void {
  const { vitals, personality, mood, line } = describeFriend(friend, state, now);
  const fam = friend.family !== undefined ? FAMILY_NAMES[friend.family] : "—";
  console.log(`${friend.collection} #${friend.tokenId}  owner ${friend.owner}  wallet ${friend.wallet}`);
  console.log(`generation ${friend.generation || "Genesis"}  tier ${friend.position.tier}  active ${friend.position.active}  weight ${rf(friend.position.weight)}  family ${fam}`);
  console.log(`unclaimed ${rf(friend.rewards.earnedRf)} RF, ${weiToRf(friend.rewards.earnedWeth).toFixed(6)} WETH   savings ${rf(friend.savings.rf)} RF, ${weiToRf(friend.savings.weth).toFixed(6)} WETH, ${weiToRf(friend.savings.eth).toFixed(6)} ETH`);
  console.log(`stream share ${(vitals.streamShare * 100).toFixed(6)}%  weekly ${vitals.weeklyRfFromStream.toFixed(3)} RF  hunger ${vitals.hunger.toFixed(2)}  mood ${mood}`);
  if (personality) console.log(`name ${personality.name}  ${personality.temperament}  favourite hour ${personality.favouriteHour}h UTC  says: "${line}"`);
  if (ascii) console.log(ascii);
}

function printPlan(actions: StewardAction[]): void {
  for (const a of actions) {
    const be = a.breakEvenWeeks === null ? "—" : `${a.breakEvenWeeks.toFixed(1)} wk`;
    console.log(`${a.kind.padEnd(6)} ${a.label.padEnd(44)} cost ${a.costRf.toLocaleString("en-US").padStart(10)} RF  burn ${a.burnRf.toLocaleString("en-US").padStart(9)}  +weight ${a.deltaWeight.toLocaleString("en-US").padStart(10)}  break-even ${be}`);
    console.log(`       ${a.rationale}`);
  }
}

function loadSnapshot(): Snapshot | null {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const p of [resolve(here, "../../web/public/data/snapshot.json"), resolve(here, "../../../apps/web/public/data/snapshot.json"), resolve(process.cwd(), "apps/web/public/data/snapshot.json")]) {
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8")) as Snapshot;
  }
  return null;
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { json: { type: "boolean" }, "dry-run": { type: "boolean" }, rpc: { type: "string" }, help: { type: "boolean", short: "h" } } });
  const [cmd, ...rest] = positionals;
  if (!cmd || values.help) { console.log(HELP); return 0; }
  const client = createNestClient(values.rpc ? { rpcUrl: values.rpc } : {});
  const now = Math.floor(Date.now() / 1000);

  if (cmd === "state") {
    const collection = parseCollection(rest[0]);
    const tokenId = BigInt(rest[1] ?? "0");
    const [state, friend] = await Promise.all([readProtocolState(client), readFriend(client, collection, tokenId)]);
    const ascii = await spriteAscii(client, friend);
    if (values.json) { console.log(json({ state, friend, ...describeFriend(friend, state, now), sprite: ascii })); return 0; }
    printFriend(friend, state, ascii, now); return 0;
  }
  if (cmd === "household") {
    const owner = parseAddress(rest[0]);
    const [state, household] = await Promise.all([readProtocolState(client), readHousehold(client, owner)]);
    if (values.json) { console.log(json({ state, household })); return 0; }
    console.log(`household ${owner}: ${household.friends.length} Friends, egg ${household.eggTokenId ?? "none"}, ${rf(household.rfBalance)} RF, allowance ${rf(household.rfAllowance)} RF`);
    for (const f of household.friends) { printFriend(f, state, null, now); console.log(""); }
    return 0;
  }
  if (cmd === "plan" || cmd === "dryrun-doc") {
    const owners = cmd === "plan" ? [parseAddress(rest[0])] : rest.map(parseAddress);
    const state = await readProtocolState(client);
    const rows: string[] = [];
    for (const owner of owners) {
      const household = await readHousehold(client, owner);
      const actions = planHousehold(household, state);
      let dry: Awaited<ReturnType<typeof dryRunAll>>[] | null = null;
      if (values["dry-run"] || cmd === "dryrun-doc") {
        dry = [];
        for (const a of actions) {
          dry.push(await dryRunAll(client, owner, a.txs)); // sequential: the public RPC rate-limits
          await new Promise((r) => setTimeout(r, 400));
        }
      }
      if (cmd === "dryrun-doc") {
        actions.forEach((a, i) => dry![i]!.forEach((r, j) => rows.push(`| ${owner} | ${a.label} | ${a.txs[j]!.description} | ${r.ok ? `ok, gas ${r.gas}` : `revert ${r.revertReason ?? r.revertSelector ?? "?"}`} |`)));
        continue;
      }
      if (values.json) { console.log(json({ state, household, actions, dryRun: dry })); return 0; }
      printPlan(actions);
      if (dry) actions.forEach((a, i) => dry[i]!.forEach((r, j) => console.log(`       dry-run ${a.txs[j]!.description}: ${r.ok ? `ok, gas ${r.gas}` : `revert ${r.revertReason ?? r.revertSelector ?? "unknown"}`}`)));
    }
    if (cmd === "dryrun-doc") {
      console.log(`Block ${state.blockNumber}, ${new Date(state.timestamp * 1000).toISOString()}. Every row is an eth_call + eth_estimateGas from the real owner's address; nothing was sent.\n`);
      console.log("| Owner | Action | Transaction | Result |\n|---|---|---|---|"); rows.forEach((r) => console.log(r));
    }
    return 0;
  }
  if (cmd === "census") {
    const state = await readProtocolState(client);
    const snap = loadSnapshot();
    if (values.json) { console.log(json({ state, snapshot: snap })); return 0; }
    console.log(`block ${state.blockNumber}  ${new Date(state.timestamp * 1000).toISOString()}`);
    console.log(`RF supply ${rf(state.rfTotalSupply)} (burned ${rf(1_024_000_000n * 10n ** 18n - state.rfTotalSupply)})`);
    console.log(`total weight ${rf(state.totalWeight)}  RF stream ${rf(state.rfStream.amount)} ends ${new Date(state.rfStream.periodFinish * 1000).toISOString()}  WETH stream ${weiToRf(state.wethStream.amount).toFixed(4)}`);
    if (snap) {
      console.log(`snapshot @${snap.blockNumber}: ${snap.totals.burnEvents} burn events, ${Math.round(snap.totals.burnedRf).toLocaleString("en-US")} RF burned; hardwired ${snap.hardwired.total} by ${snap.hardwired.wallets} wallets; genesis ${snap.genesis.activated} active / ${snap.genesis.inactive} inactive (${snap.genesis.reserveHeld} in reserve)`);
      console.log("top households by RF burned:");
      snap.leaderboard.slice(0, 10).forEach((h, i) => console.log(`  ${String(i + 1).padStart(2)}. ${h.owner}  ${Math.round(h.burnedRf).toLocaleString("en-US").padStart(12)} RF  ${h.actions} actions`));
    } else console.log("no snapshot.json found (run the indexer)");
    return 0;
  }
  console.error(`unknown command ${cmd}\n${HELP}`); return 2;
}

main(process.argv.slice(2)).then((code) => process.exit(code), (err: unknown) => { console.error(err instanceof Error ? err.message : String(err)); process.exit(1); });
