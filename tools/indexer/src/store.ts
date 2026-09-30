/**
 * On-disk persistence: JSONL caches of raw records (exact incremental merges) and atomic JSON writes.
 * bigint fields are serialised as decimal strings.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Address, Hex } from "viem";
import type { ForeignBurn, IndexedBurn } from "./burns.js";

interface BurnLine {
  txHash: Hex;
  blockNumber: string;
  logIndex: number;
  timestamp: number;
  from: Address;
  action: IndexedBurn["action"];
  burnedRf: string;
}

export function serializeBurn(r: IndexedBurn): string {
  const line: BurnLine = {
    txHash: r.txHash,
    blockNumber: r.blockNumber.toString(),
    logIndex: r.logIndex,
    timestamp: r.timestamp,
    from: r.from,
    action: r.action,
    burnedRf: r.burnedRf.toString(),
  };
  return JSON.stringify(line);
}

export function parseBurn(line: string): IndexedBurn {
  const o = JSON.parse(line) as BurnLine;
  return {
    txHash: o.txHash,
    blockNumber: BigInt(o.blockNumber),
    logIndex: o.logIndex,
    timestamp: o.timestamp,
    from: o.from,
    action: o.action,
    burnedRf: BigInt(o.burnedRf),
  };
}

interface ForeignLine {
  txHash: Hex;
  blockNumber: string;
  logIndex: number;
  from: Address;
  burnedRf: string;
}

export function serializeForeign(r: ForeignBurn): string {
  const line: ForeignLine = { txHash: r.txHash, blockNumber: r.blockNumber.toString(), logIndex: r.logIndex, from: r.from, burnedRf: r.burnedRf.toString() };
  return JSON.stringify(line);
}

export function parseForeign(line: string): ForeignBurn {
  const o = JSON.parse(line) as ForeignLine;
  return { txHash: o.txHash, blockNumber: BigInt(o.blockNumber), logIndex: o.logIndex, from: o.from, burnedRf: BigInt(o.burnedRf) };
}

export function readJsonl<T>(path: string, parse: (line: string) => T): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map(parse);
}

/** Write via a sibling .tmp file then rename, so a crash never leaves a truncated file. */
function writeAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

export function writeJsonl<T>(path: string, records: readonly T[], serialize: (r: T) => string): void {
  writeAtomic(path, records.map(serialize).join("\n") + (records.length ? "\n" : ""));
}

export function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function writeJson(path: string, value: unknown): void {
  writeAtomic(path, JSON.stringify(value, null, 2) + "\n");
}
