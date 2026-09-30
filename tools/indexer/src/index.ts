/**
 * CLI: tsx src/index.ts [--from N] [--to N] [--full] [--out DIR] [--cache DIR]
 *
 * Builds apps/web/public/data/snapshot.json (+ snapshot.meta.json) from the public RPC, throttled.
 * Incremental by default: resumes from the previous snapshot's blockNumber + 1 and merges with the raw
 * burn records cached in tools/indexer/cache/burns.jsonl. --full discards the caches and re-indexes.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatUnits } from "viem";
import { ADDRESSES, ERC20_ABI, type Snapshot } from "@nest/core";
import { indexBurns, mergeBurns, type ForeignBurn, type IndexedBurn } from "./burns.js";
import { censusGenesis } from "./genesis.js";
import { applyHardwiredEvents, emptyHardwiredState, HARDWIRED_FIRST_BLOCK, indexHardwired, toSnapshotHardwired, type HardwiredState } from "./hardwired.js";
import { Rpc } from "./rpc.js";
import { buildSnapshot, INITIAL_RF_SUPPLY_RF, weiToRf } from "./snapshot.js";
import { parseBurn, parseForeign, readJson, readJsonl, serializeBurn, serializeForeign, writeJson, writeJsonl } from "./store.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const DEFAULT_OUT_DIR = resolve(REPO_ROOT, "apps/web/public/data");
const DEFAULT_CACHE_DIR = resolve(HERE, "../cache");

interface Args {
  from: bigint | null;
  to: bigint | null;
  full: boolean;
  outDir: string;
  cacheDir: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { from: null, to: null, full: false, outDir: DEFAULT_OUT_DIR, cacheDir: DEFAULT_CACHE_DIR };
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
        args.full = true;
        break;
      case "--out":
        args.outDir = resolve(next());
        break;
      case "--cache":
        args.cacheDir = resolve(next());
        break;
      case "--help":
      case "-h":
        process.stderr.write("usage: tsx src/index.ts [--from N] [--to N] [--full] [--out DIR] [--cache DIR]\n");
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

interface RunMeta {
  generatedAt: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  run: {
    mode: "full" | "incremental";
    fromBlock: number;
    toBlock: number;
    blocksScanned: number;
    newBurnRecords: number;
    newForeignBurns: number;
    hardwiredFromBlock: number | null;
    rpc: { requests: number; retries: number; rateLimited: number };
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
  cache: { burns: string; foreignBurns: string; hardwired: string; burnRecords: number };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const paths = {
    snapshot: resolve(args.outDir, "snapshot.json"),
    meta: resolve(args.outDir, "snapshot.meta.json"),
    burns: resolve(args.cacheDir, "burns.jsonl"),
    foreign: resolve(args.cacheDir, "foreign-burns.jsonl"),
    hardwired: resolve(args.cacheDir, "hardwired.json"),
  };
  const rpc = new Rpc({ log });

  const latest = await rpc.call("blockNumber", () => rpc.client.getBlockNumber());
  const toBlock = args.to ?? latest;
  if (toBlock > latest) throw new Error(`--to ${toBlock} is beyond the chain head ${latest}`);

  // Resume point.
  const previous = args.full ? null : readJson<Snapshot>(paths.snapshot);
  let cachedBurns: IndexedBurn[] = args.full ? [] : readJsonl(paths.burns, parseBurn);
  let cachedForeign: ForeignBurn[] = args.full ? [] : readJsonl(paths.foreign, parseForeign);
  let mode: RunMeta["run"]["mode"] = "incremental";
  let fromBlock: bigint;
  if (args.from !== null) {
    fromBlock = args.from;
    if (previous === null || cachedBurns.length === 0) mode = "full";
  } else if (previous !== null && cachedBurns.length > 0) {
    fromBlock = BigInt(previous.blockNumber) + 1n;
  } else {
    if (previous !== null) log("snapshot exists but the burns cache is empty: running a full index");
    mode = "full";
    fromBlock = 0n;
    cachedBurns = [];
    cachedForeign = [];
  }
  if (mode === "full") log(`full index: blocks ${fromBlock}..${toBlock} (head ${latest})`);
  else log(`incremental index: blocks ${fromBlock}..${toBlock} (head ${latest}), ${cachedBurns.length} cached burn records`);
  if (fromBlock > toBlock) log("nothing new to scan; rebuilding the snapshot from cache");

  // Burns.
  const burns = await indexBurns(rpc, fromBlock, toBlock, { log });
  const allBurns = mergeBurns(cachedBurns, burns.records, fromBlock);
  const allForeign = mergeBurns(cachedForeign, burns.foreign, fromBlock);
  writeJsonl(paths.burns, allBurns, serializeBurn);
  writeJsonl(paths.foreign, allForeign, serializeForeign);
  log(`burns: ${allBurns.length} records after merge (+${burns.records.length}), ${allForeign.length} foreign (+${burns.foreign.length})`);

  // Hardwired census (always complete from the first event, whatever --from says).
  let hardwired = args.full ? null : readJson<HardwiredState>(paths.hardwired);
  let hardwiredFrom: bigint | null;
  if (hardwired === null || BigInt(hardwired.toBlock) > toBlock || hardwired.fromBlock !== Number(HARDWIRED_FIRST_BLOCK)) {
    hardwired = emptyHardwiredState(HARDWIRED_FIRST_BLOCK);
    hardwiredFrom = HARDWIRED_FIRST_BLOCK;
  } else {
    hardwiredFrom = BigInt(hardwired.toBlock) + 1n;
  }
  if (hardwiredFrom <= toBlock) {
    log(`hardwired: scanning ${hardwiredFrom}..${toBlock}`);
    const events = await indexHardwired(rpc, hardwiredFrom, toBlock, log);
    hardwired = applyHardwiredEvents(hardwired, events, toBlock);
    writeJson(paths.hardwired, hardwired);
  } else {
    hardwiredFrom = null;
  }
  log(`hardwired: ${hardwired.total} events, ${hardwired.wallets.length} wallets, first block ${hardwired.firstBlock}`);

  // Genesis census and supply, both at the head (historical state is pruned on the public node).
  const genesis = await censusGenesis(rpc, log);
  log(`genesis: ${genesis.summary.activated} activated, ${genesis.summary.inactive} inactive (${genesis.summary.reserveHeld} in reserve)`);
  const rfTotalSupply = await rpc.call("rf.totalSupply", () =>
    rpc.client.readContract({ address: ADDRESSES.rf, abi: ERC20_ABI, functionName: "totalSupply" }),
  );
  const toBlockHeader = await rpc.call("getBlock(to)", () => rpc.client.getBlock({ blockNumber: toBlock, includeTransactions: false }));

  // Snapshot.
  const snapshot = buildSnapshot({
    records: allBurns,
    hardwired: toSnapshotHardwired(hardwired),
    genesis: { activated: genesis.summary.activated, inactive: genesis.summary.inactive, reserveHeld: genesis.summary.reserveHeld },
    blockNumber: Number(toBlock),
    timestamp: Number(toBlockHeader.timestamp),
  });
  writeJson(paths.snapshot, snapshot);

  // Meta and reconciliation.
  const foreignWei = allForeign.reduce((s, r) => s + r.burnedRf, 0n);
  const byFromWei = new Map<string, { count: number; wei: bigint }>();
  for (const r of allForeign) {
    const e = byFromWei.get(r.from) ?? { count: 0, wei: 0n };
    e.count++;
    e.wei += r.burnedRf;
    byFromWei.set(r.from, e);
  }
  const byFrom: RunMeta["foreignBurns"]["byFrom"] = {};
  for (const [from, e] of [...byFromWei.entries()].sort((a, b) => (a[1].wei > b[1].wei ? -1 : 1)).slice(0, 20)) byFrom[from] = { count: e.count, burnedRf: weiToRf(e.wei) };
  const rfTotalSupplyRf = Number(formatUnits(rfTotalSupply, 18));
  const impliedBurnedRf = INITIAL_RF_SUPPLY_RF - rfTotalSupplyRf;
  const indexedBurnedRf = snapshot.totals.burnedRf;
  const foreignBurnedRf = weiToRf(foreignWei);
  const gapRf = impliedBurnedRf - indexedBurnedRf;
  const finishedAt = Date.now();
  const meta: RunMeta = {
    generatedAt: new Date(finishedAt).toISOString(),
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    durationMs: finishedAt - startedAt,
    run: {
      mode,
      fromBlock: Number(fromBlock),
      toBlock: Number(toBlock),
      blocksScanned: Number(toBlock - fromBlock + 1n > 0n ? toBlock - fromBlock + 1n : 0n),
      newBurnRecords: burns.records.length,
      newForeignBurns: burns.foreign.length,
      hardwiredFromBlock: hardwiredFrom === null ? null : Number(hardwiredFrom),
      rpc: { ...rpc.stats },
    },
    reconciliation: {
      rfTotalSupplyWei: rfTotalSupply.toString(),
      rfTotalSupplyRf,
      initialSupplyRf: INITIAL_RF_SUPPLY_RF,
      impliedBurnedRf,
      indexedBurnedRf,
      foreignBurnedRf,
      indexedPlusForeignRf: indexedBurnedRf + foreignBurnedRf,
      gapRf,
      gapPct: impliedBurnedRf > 0 ? (gapRf / impliedBurnedRf) * 100 : 0,
    },
    foreignBurns: { count: allForeign.length, burnedRf: foreignBurnedRf, byFrom },
    genesis: { blockNumber: genesis.blockNumber, unreadable: genesis.summary.unreadable, inactiveByOwner: genesis.summary.inactiveByOwner },
    cache: { burns: paths.burns, foreignBurns: paths.foreign, hardwired: paths.hardwired, burnRecords: allBurns.length },
  };
  writeJson(paths.meta, meta);

  log(`snapshot written: ${paths.snapshot}`);
  log(`burn events ${snapshot.totals.burnEvents}, burned ${indexedBurnedRf.toFixed(2)} RF (implied by supply ${impliedBurnedRf.toFixed(2)}, gap ${gapRf.toFixed(2)} = ${meta.reconciliation.gapPct.toFixed(3)}%)`);
  log(`by action: ${JSON.stringify(snapshot.totals.byAction)}`);
  log(`daily series: ${snapshot.daily.length} days, leaderboard ${snapshot.leaderboard.length}`);
  log(`rpc: ${rpc.stats.requests} requests, ${rpc.stats.retries} retries (${rpc.stats.rateLimited} rate-limited), ${((finishedAt - startedAt) / 1000).toFixed(1)} s`);
}

main().catch((err) => {
  log(`FATAL: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
