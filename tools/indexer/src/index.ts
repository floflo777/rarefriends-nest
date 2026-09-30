/**
 * CLI: tsx src/index.ts [--full] [--recent N] [--backfill] [--from N] [--to N] [--out DIR] [--cache DIR]
 *
 * Builds apps/web/public/data/snapshot.json (+ snapshot.meta.json) from the public RPC, throttled.
 * The cache (tools/indexer/cache/) holds the raw burn records (burns.jsonl, foreign-burns.jsonl), the
 * hardwired census state and state.json = the contiguous block range whose burns are fully indexed
 * ("coverage"). Every getLogs window is flushed to the cache and to a partial snapshot, so an interrupted
 * run loses at most one window.
 *
 * Modes:
 *   (default)     extend coverage forward from coveredTo + 1 to the chain head; full index when no coverage
 *   --recent N    index the last N blocks (head - N + 1 .. head) newest first, replacing any coverage that
 *                 does not touch that range
 *   --backfill    extend coverage backward from coveredFrom - 1 down to --from (default 0), newest first
 *   --full        discard the cache and index --from (default 0) .. --to (default head)
 *   --from/--to   explicit bounds; with neither mode flag, an explicit --from re-indexes from there
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatUnits } from "viem";
import { ADDRESSES, ERC20_ABI, type Snapshot } from "@nest/core";
import { indexBurns, mergeBurns, type BurnWindow, type ForeignBurn, type IndexedBurn } from "./burns.js";
import { censusGenesis, type GenesisSummary } from "./genesis.js";
import { applyHardwiredEvents, emptyHardwiredState, HARDWIRED_FIRST_BLOCK, indexHardwired, toSnapshotHardwired, type HardwiredState } from "./hardwired.js";
import { Rpc } from "./rpc.js";
import { buildSnapshot, INITIAL_RF_SUPPLY_RF, weiToRf } from "./snapshot.js";
import { parseBurn, parseForeign, readJson, readJsonl, serializeBurn, serializeForeign, writeJson, writeJsonl } from "./store.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const DEFAULT_OUT_DIR = resolve(REPO_ROOT, "apps/web/public/data");
const DEFAULT_CACHE_DIR = resolve(HERE, "../cache");

type Mode = "forward" | "recent" | "backfill" | "full";

interface Args {
  mode: Mode;
  recent: bigint;
  from: bigint | null;
  to: bigint | null;
  outDir: string;
  cacheDir: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { mode: "forward", recent: 0n, from: null, to: null, outDir: DEFAULT_OUT_DIR, cacheDir: DEFAULT_CACHE_DIR };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value after ${a}`);
      return v;
    };
    switch (a) {
      case "--from":
        args.from = BigInt(next());
        break;
      case "--to":
        args.to = BigInt(next());
        break;
      case "--full":
        args.mode = "full";
        break;
      case "--recent":
        args.mode = "recent";
        args.recent = BigInt(next());
        break;
      case "--backfill":
        args.mode = "backfill";
        break;
      case "--out":
        args.outDir = resolve(next());
        break;
      case "--cache":
        args.cacheDir = resolve(next());
        break;
      case "--help":
      case "-h":
        process.stderr.write("usage: tsx src/index.ts [--full] [--recent N] [--backfill] [--from N] [--to N] [--out DIR] [--cache DIR]\n");
        process.exit(0);
        break;
      default:
        throw new Error(`unknown argument ${a}`);
    }
  }
  return args;
}

const startedAt = Date.now();
function log(msg: string): void {
  const t = ((Date.now() - startedAt) / 1000).toFixed(1).padStart(7);
  process.stderr.write(`[${t}s] ${msg}\n`);
}

/** Contiguous block range whose burns are fully present in burns.jsonl. */
interface Coverage {
  fromBlock: number;
  toBlock: number;
}

/** The published snapshot: the core Snapshot plus the block range it actually covers. */
export interface SnapshotFile extends Snapshot {
  coverage: { fromBlock: number; toBlock: number; complete: boolean; partial: boolean };
}

interface RunMeta {
  generatedAt: string;
  startedAt: string;
  durationMs: number;
  status: "running" | "done";
  coverage: SnapshotFile["coverage"];
  run: {
    mode: Mode;
    fromBlock: number;
    toBlock: number;
    head: number;
    windowsFlushed: number;
    newBurnRecords: number;
    newForeignBurns: number;
    rpc: { requests: number; items: number; retries: number; rateLimited: number; paceFactor: number };
  };
  reconciliation: {
    rfTotalSupplyWei: string;
    rfTotalSupplyRf: number;
    initialSupplyRf: number;
    impliedBurnedRf: number;
    indexedBurnedRf: number;
    foreignBurnedRf: number;
    indexedPlusForeignRf: number;
    gapRf: number;
    gapPct: number;
  };
  foreignBurns: { count: number; burnedRf: number; byFrom: Record<string, { count: number; burnedRf: number }> };
  genesis: { blockNumber: number; unreadable: number; inactiveByOwner: Record<string, number> };
  hardwired: { fromBlock: number; toBlock: number };
  cache: { burns: string; foreignBurns: string; hardwired: string; state: string; burnRecords: number };
}

function unionCoverage(a: Coverage | null, b: Coverage): Coverage {
  if (a === null) return b;
  const touch = b.fromBlock <= a.toBlock + 1 && b.toBlock >= a.fromBlock - 1;
  if (!touch) throw new Error(`coverage ${a.fromBlock}..${a.toBlock} and ${b.fromBlock}..${b.toBlock} are not contiguous`);
  return { fromBlock: Math.min(a.fromBlock, b.fromBlock), toBlock: Math.max(a.toBlock, b.toBlock) };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const paths = {
    snapshot: resolve(args.outDir, "snapshot.json"),
    meta: resolve(args.outDir, "snapshot.meta.json"),
    burns: resolve(args.cacheDir, "burns.jsonl"),
    foreign: resolve(args.cacheDir, "foreign-burns.jsonl"),
    hardwired: resolve(args.cacheDir, "hardwired.json"),
    state: resolve(args.cacheDir, "state.json"),
  };
  const rpc = new Rpc({ log });

  const head = await rpc.call("blockNumber", () => rpc.client.getBlockNumber());
  const toCap = args.to ?? head;
  if (toCap > head) throw new Error(`--to ${toCap} is beyond the chain head ${head}`);

  // Existing coverage and caches.
  let coverage: Coverage | null = args.mode === "full" ? null : readJson<Coverage>(paths.state);
  let burns: IndexedBurn[] = coverage ? readJsonl(paths.burns, parseBurn) : [];
  let foreign: ForeignBurn[] = coverage ? readJsonl(paths.foreign, parseForeign) : [];
  if (coverage && burns.length === 0) log(`WARNING: coverage ${coverage.fromBlock}..${coverage.toBlock} but burns.jsonl is empty`);

  // Range to scan and scan direction.
  let mode = args.mode;
  let scanFrom: bigint;
  let scanTo: bigint;
  let direction: "forward" | "backward" = "forward";
  switch (mode) {
    case "full":
      scanFrom = args.from ?? 0n;
      scanTo = toCap;
      break;
    case "recent": {
      scanTo = toCap;
      scanFrom = scanTo - args.recent + 1n > 0n ? scanTo - args.recent + 1n : 0n;
      direction = "backward";
      if (coverage && BigInt(coverage.toBlock) + 1n >= scanFrom && BigInt(coverage.fromBlock) <= scanTo) {
        // Coverage touches the requested range: only fetch what is missing on each side.
        if (BigInt(coverage.fromBlock) <= scanFrom) {
          scanFrom = BigInt(coverage.toBlock) + 1n;
          direction = "forward";
        } else {
          // Coverage starts inside the range: extend backward to scanFrom and forward to the head afterwards.
          scanTo = BigInt(coverage.fromBlock) - 1n;
        }
      } else if (coverage) {
        log(`recent: existing coverage ${coverage.fromBlock}..${coverage.toBlock} does not touch ${scanFrom}..${scanTo}; discarding it`);
        coverage = null;
        burns = [];
        foreign = [];
      }
      break;
    }
    case "backfill": {
      if (coverage === null) throw new Error("--backfill needs an existing coverage (run --recent or --full first)");
      scanFrom = args.from ?? 0n;
      scanTo = BigInt(coverage.fromBlock) - 1n;
      direction = "backward";
      if (args.to !== null) log("--to is ignored with --backfill");
      break;
    }
    case "forward":
    default: {
      if (args.from !== null) {
        // Explicit lower bound: re-index from there, dropping cached records at or after it.
        scanFrom = args.from;
        if (coverage && BigInt(coverage.fromBlock) > scanFrom) {
          coverage = null;
          burns = [];
          foreign = [];
        }
      } else if (coverage) {
        scanFrom = BigInt(coverage.toBlock) + 1n;
      } else {
        mode = "full";
        scanFrom = 0n;
      }
      scanTo = toCap;
      break;
    }
  }
  log(`${mode}: scanning ${scanFrom}..${scanTo} ${direction} (head ${head}); coverage ${coverage ? `${coverage.fromBlock}..${coverage.toBlock}` : "none"}, ${burns.length} cached burn records`);
  if (scanFrom > scanTo) log("nothing to scan; rebuilding the snapshot from cache");

  // Cheap censuses first so the very first partial snapshot already carries them.
  let hardwired = args.mode === "full" ? null : readJson<HardwiredState>(paths.hardwired);
  if (hardwired === null || BigInt(hardwired.toBlock) > toCap || hardwired.fromBlock !== Number(HARDWIRED_FIRST_BLOCK)) hardwired = emptyHardwiredState(HARDWIRED_FIRST_BLOCK);
  const hardwiredFrom = BigInt(hardwired.toBlock) + 1n;
  if (hardwiredFrom <= toCap) {
    log(`hardwired: scanning ${hardwiredFrom}..${toCap}`);
    const events = await indexHardwired(rpc, hardwiredFrom, toCap, log);
    hardwired = applyHardwiredEvents(hardwired, events, toCap);
    writeJson(paths.hardwired, hardwired);
  }
  log(`hardwired: ${hardwired.total} events, ${hardwired.wallets.length} wallets, first block ${hardwired.firstBlock}`);

  const genesis = await censusGenesis(rpc, log);
  log(`genesis: ${genesis.summary.activated} activated, ${genesis.summary.inactive} inactive (${genesis.summary.reserveHeld} in reserve)`);
  const rfTotalSupply = await rpc.call("rf.totalSupply", () => rpc.client.readContract({ address: ADDRESSES.rf, abi: ERC20_ABI, functionName: "totalSupply" }));
  const snapshotBlock = coverage && BigInt(coverage.toBlock) > scanTo ? BigInt(coverage.toBlock) : scanTo;
  const snapshotHeader = await rpc.call("getBlock(snapshot)", () => rpc.client.getBlock({ blockNumber: snapshotBlock, includeTransactions: false }));

  // Flush: merge one window into the cache, then rewrite cache + snapshot + meta.
  let windowsFlushed = 0;
  let newBurns = 0;
  let newForeign = 0;
  const flush = (status: RunMeta["status"]): void => {
    if (coverage === null) return;
    writeJsonl(paths.burns, burns, serializeBurn);
    writeJsonl(paths.foreign, foreign, serializeForeign);
    writeJson(paths.state, coverage);
    const complete = coverage.fromBlock === 0 && BigInt(coverage.toBlock) >= snapshotBlock;
    const coverageOut: SnapshotFile["coverage"] = { fromBlock: coverage.fromBlock, toBlock: coverage.toBlock, complete, partial: !complete };
    const snapshot: SnapshotFile = {
      ...buildSnapshot({
        records: burns,
        hardwired: toSnapshotHardwired(hardwired),
        genesis: { activated: genesis.summary.activated, inactive: genesis.summary.inactive, reserveHeld: genesis.summary.reserveHeld },
        blockNumber: coverage.toBlock,
        timestamp: Number(snapshotHeader.timestamp),
      }),
      coverage: coverageOut,
    };
    writeJson(paths.snapshot, snapshot);
    writeJson(paths.meta, buildMeta({ status, coverage: coverageOut, mode, scanFrom, scanTo, head, windowsFlushed, newBurns, newForeign, rpc, snapshot, foreign, rfTotalSupply, genesis: genesis.summary, genesisBlock: genesis.blockNumber, hardwired, paths, burnRecords: burns.length }));
  };

  const onWindow = async (w: BurnWindow): Promise<void> => {
    burns = mergeBurns(burns, w.records, w.fromBlock, w.toBlock);
    foreign = mergeBurns(foreign, w.foreign, w.fromBlock, w.toBlock);
    coverage = unionCoverage(coverage, { fromBlock: Number(w.fromBlock), toBlock: Number(w.toBlock) });
    windowsFlushed++;
    newBurns += w.records.length;
    newForeign += w.foreign.length;
    flush("running");
    log(`flush: coverage ${coverage.fromBlock}..${coverage.toBlock}, ${burns.length} burn records, ${rpc.stats.requests} requests (${rpc.stats.rateLimited} rate-limited, pace x${rpc.paceFactor.toFixed(2)})`);
  };

  if (scanFrom <= scanTo) await indexBurns(rpc, scanFrom, scanTo, { log, direction, onWindow });
  else if (coverage) flush("running");

  // In "recent" mode with coverage starting inside the range, also catch up to the head.
  if (mode === "recent" && coverage && BigInt(coverage.toBlock) < toCap) {
    const from = BigInt(coverage.toBlock) + 1n;
    log(`recent: catching up ${from}..${toCap} forward`);
    await indexBurns(rpc, from, toCap, { log, direction: "forward", onWindow });
  }

  flush("done");
  if (coverage === null) throw new Error("no coverage after the run");
  const snapshot = readJson<SnapshotFile>(paths.snapshot);
  const meta = readJson<RunMeta>(paths.meta);
  if (snapshot === null || meta === null) throw new Error("snapshot not written");
  log(`snapshot written: ${paths.snapshot} (coverage ${snapshot.coverage.fromBlock}..${snapshot.coverage.toBlock}${snapshot.coverage.complete ? ", complete" : ", PARTIAL"})`);
  log(`burn events ${snapshot.totals.burnEvents}, burned ${snapshot.totals.burnedRf.toFixed(2)} RF (implied by supply ${meta.reconciliation.impliedBurnedRf.toFixed(2)}, gap ${meta.reconciliation.gapRf.toFixed(2)} = ${meta.reconciliation.gapPct.toFixed(3)}%)`);
  log(`by action: ${JSON.stringify(snapshot.totals.byAction)}`);
  log(`daily series: ${snapshot.daily.length} days, leaderboard ${snapshot.leaderboard.length}`);
  log(`rpc: ${rpc.stats.requests} requests / ${rpc.stats.items} items, ${rpc.stats.retries} retries (${rpc.stats.rateLimited} rate-limited), ${((Date.now() - startedAt) / 1000).toFixed(1)} s`);
}

interface MetaInput {
  status: RunMeta["status"];
  coverage: SnapshotFile["coverage"];
  mode: Mode;
  scanFrom: bigint;
  scanTo: bigint;
  head: bigint;
  windowsFlushed: number;
  newBurns: number;
  newForeign: number;
  rpc: Rpc;
  snapshot: SnapshotFile;
  foreign: readonly ForeignBurn[];
  rfTotalSupply: bigint;
  genesis: GenesisSummary;
  genesisBlock: number;
  hardwired: HardwiredState;
  paths: { burns: string; foreign: string; hardwired: string; state: string };
  burnRecords: number;
}

function buildMeta(m: MetaInput): RunMeta {
  const byFromWei = new Map<string, { count: number; wei: bigint }>();
  let foreignWei = 0n;
  for (const r of m.foreign) {
    foreignWei += r.burnedRf;
    const e = byFromWei.get(r.from) ?? { count: 0, wei: 0n };
    e.count++;
    e.wei += r.burnedRf;
    byFromWei.set(r.from, e);
  }
  const byFrom: RunMeta["foreignBurns"]["byFrom"] = {};
  for (const [from, e] of [...byFromWei.entries()].sort((a, b) => (a[1].wei > b[1].wei ? -1 : 1)).slice(0, 20)) byFrom[from] = { count: e.count, burnedRf: weiToRf(e.wei) };
  const rfTotalSupplyRf = Number(formatUnits(m.rfTotalSupply, 18));
  const impliedBurnedRf = INITIAL_RF_SUPPLY_RF - rfTotalSupplyRf;
  const indexedBurnedRf = m.snapshot.totals.burnedRf;
  const foreignBurnedRf = weiToRf(foreignWei);
  const gapRf = impliedBurnedRf - indexedBurnedRf;
  const now = Date.now();
  return {
    generatedAt: new Date(now).toISOString(),
    startedAt: new Date(startedAt).toISOString(),
    durationMs: now - startedAt,
    status: m.status,
    coverage: m.coverage,
    run: {
      mode: m.mode,
      fromBlock: Number(m.scanFrom),
      toBlock: Number(m.scanTo),
      head: Number(m.head),
      windowsFlushed: m.windowsFlushed,
      newBurnRecords: m.newBurns,
      newForeignBurns: m.newForeign,
      rpc: { ...m.rpc.stats, paceFactor: m.rpc.paceFactor },
    },
    reconciliation: {
      rfTotalSupplyWei: m.rfTotalSupply.toString(),
      rfTotalSupplyRf,
      initialSupplyRf: INITIAL_RF_SUPPLY_RF,
      impliedBurnedRf,
      indexedBurnedRf,
      foreignBurnedRf,
      indexedPlusForeignRf: indexedBurnedRf + foreignBurnedRf,
      gapRf,
      gapPct: impliedBurnedRf > 0 ? (gapRf / impliedBurnedRf) * 100 : 0,
    },
    foreignBurns: { count: m.foreign.length, burnedRf: foreignBurnedRf, byFrom },
    genesis: { blockNumber: m.genesisBlock, unreadable: m.genesis.unreadable, inactiveByOwner: m.genesis.inactiveByOwner },
    hardwired: { fromBlock: m.hardwired.fromBlock, toBlock: m.hardwired.toBlock },
    cache: { burns: m.paths.burns, foreignBurns: m.paths.foreign, hardwired: m.paths.hardwired, state: m.paths.state, burnRecords: m.burnRecords },
  };
}

main().catch((err) => {
  log(`FATAL: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
