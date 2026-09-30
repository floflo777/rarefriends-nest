/**
 * Throttled viem client for Robinhood Chain (4663), shared by every indexer module.
 *
 * - JSON-RPC batching: up to `batchSize` (20) calls per HTTP request through viem's http transport. Measured on
 *   2026-09-30: batches of 25+ items get HTTP 429 about a third of the time, 20 items about a tenth.
 * - Pacing: at least `minIntervalMs` (150 ms) between HTTP requests and a budget of `itemsPerSecond` (50)
 *   JSON-RPC items, since the node counts every item of a batch against its ~100 req/s limit.
 * - Exponential backoff with jitter on HTTP 429 and transient network errors.
 * - Adaptive block windows for eth_getLogs: start at 2,000,000 blocks, halve when the node refuses the
 *   range ("logs matched by query exceeds limit", "log query timed out"), double when a window is sparse.
 */
import { createPublicClient, defineChain, http, HttpRequestError, TimeoutError, type HttpTransport, type PublicClient } from "viem";
import { ADDRESSES, CHAIN_ID, RPC_URL } from "@nest/core";

export const robinhoodChain = defineChain({
  id: CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  contracts: { multicall3: { address: ADDRESSES.multicall3 } },
});

export interface RpcOptions {
  url?: string;
  /** Max JSON-RPC calls per HTTP batch. */
  batchSize?: number;
  /** Minimum spacing between two HTTP requests, in ms. */
  minIntervalMs?: number;
  /** Budget of JSON-RPC items per second: a batch of N items reserves N / itemsPerSecond seconds. */
  itemsPerSecond?: number;
  /** Attempts per request on retryable errors before giving up. */
  maxAttempts?: number;
  /** Base delay of the exponential backoff, in ms. */
  backoffBaseMs?: number;
  /** Cap of a single backoff delay, in ms. */
  backoffMaxMs?: number;
  /** HTTP timeout per request, in ms. */
  timeoutMs?: number;
  log?: (msg: string) => void;
}

export interface RpcStats {
  requests: number;
  /** JSON-RPC items sent (a batch of 20 counts 20). */
  items: number;
  retries: number;
  rateLimited: number;
}

export type ErrorKind = "rate-limit" | "log-range" | "transient" | "fatal";

export interface ScanOptions {
  fromBlock: bigint;
  toBlock: bigint;
  /** First window size in blocks (default 2,000,000). */
  initialWindow?: bigint;
  /** Never shrink below this (default 1,000). */
  minWindow?: bigint;
  /** Never grow above this (default 8,000,000). */
  maxWindow?: bigint;
  /** A window returning fewer logs than this doubles the next window (default 2,000). */
  sparseThreshold?: number;
  /** "backward" walks from toBlock down to fromBlock (default "forward"). */
  direction?: "forward" | "backward";
  label?: string;
}

export interface ScanChunk<T> {
  fromBlock: bigint;
  toBlock: bigint;
  window: bigint;
  logs: T[];
}

export type Client = PublicClient<HttpTransport, typeof robinhoodChain>;

/** NEST_RPC_DEBUG=1 prints every HTTP exchange (item count and response shape) to stderr. */
const DEBUG = process.env["NEST_RPC_DEBUG"] === "1";

async function debugRequest(req: Request): Promise<void> {
  const body = JSON.parse(await req.clone().text()) as unknown;
  const items = Array.isArray(body) ? body : [body];
  process.stderr.write(`[rpc] -> ${items.length} x ${(items[0] as { method?: string })?.method ?? "?"}\n`);
}

async function debugResponse(res: Response): Promise<void> {
  const text = await res.clone().text();
  let shape: string;
  try {
    const parsed = JSON.parse(text) as unknown;
    shape = Array.isArray(parsed) ? `array[${parsed.length}]` : text.slice(0, 300);
  } catch {
    shape = `non-json ${text.slice(0, 300)}`;
  }
  process.stderr.write(`[rpc] <- ${res.status} ${shape}\n`);
}

function makeClient(url: string, batchSize: number, timeoutMs: number): Client {
  return createPublicClient({
    chain: robinhoodChain,
    transport: http(url, {
      batch: { batchSize, wait: 16 },
      retryCount: 0, // retries are handled by Rpc.call so they are throttled and logged
      timeout: timeoutMs,
      ...(DEBUG ? { onFetchRequest: debugRequest } : {}),
      /**
       * viem returns a non-2xx body verbatim when it looks like a JSON-RPC error; for a batch this yields a
       * single object instead of an array and every item fails with a confusing TypeError. Surface the HTTP
       * status instead so 429 is retried with backoff.
       */
      onFetchResponse: async (res: Response) => {
        if (DEBUG) await debugResponse(res);
        if (!res.ok) {
          const details = await res.clone().text().catch(() => "");
          throw new HttpRequestError({ url, status: res.status, headers: res.headers, details: details.slice(0, 300) || res.statusText });
        }
      },
    }),
  });
}

/** Collect messages and HTTP status codes along the `cause` chain of an error. */
function inspectError(err: unknown): { text: string; status: number | undefined; timeout: boolean } {
  const parts: string[] = [];
  let status: number | undefined;
  let timeout = false;
  let e: unknown = err;
  for (let depth = 0; e && typeof e === "object" && depth < 10; depth++) {
    const o = e as Record<string, unknown>;
    for (const k of ["shortMessage", "message", "details"]) {
      if (typeof o[k] === "string") parts.push(o[k] as string);
    }
    if (typeof o["status"] === "number" && status === undefined) status = o["status"] as number;
    if (e instanceof TimeoutError) timeout = true;
    e = o["cause"];
  }
  return { text: parts.join(" | "), status, timeout };
}

export function classifyError(err: unknown): ErrorKind {
  const { text, status, timeout } = inspectError(err);
  if (status === 429 || /\b429\b|too many requests|rate limit/i.test(text)) return "rate-limit";
  if (/exceeds limit|query timed out|too many results|more than \d+ results|response size|block range is too|query returned/i.test(text)) {
    return "log-range";
  }
  if (
    timeout ||
    (status !== undefined && status >= 500) ||
    /timed out|timeout|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|fetch failed|socket hang up|network error|\b50[234]\b/i.test(text)
  ) {
    return "transient";
  }
  return "fatal";
}

/** Distinct messages along the cause chain on one line, the node's own details included. */
export function shortMessage(err: unknown): string {
  const { text } = inspectError(err);
  const parts = [...new Set(text.split(" | ").map((p) => p.split("\n")[0]?.trim() ?? "").filter((p) => p.length > 0))];
  return (parts.join(" | ") || String(err)).slice(0, 240);
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  const raw = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.round(raw * (1 + Math.random() * 0.25));
}

export class Rpc {
  readonly client: Client;
  readonly batchSize: number;
  readonly stats: RpcStats = { requests: 0, items: 0, retries: 0, rateLimited: 0 };
  /** Multiplier on the pacing reservation: grows on 429, decays on success (AIMD). */
  paceFactor = 1;
  private readonly minIntervalMs: number;
  private readonly itemsPerSecond: number;
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly log: (msg: string) => void;
  private lastRequestAt = 0;
  private reservedMs = 0;
  private gate: Promise<void> = Promise.resolve();

  constructor(opts: RpcOptions = {}) {
    this.batchSize = opts.batchSize ?? 20;
    this.minIntervalMs = opts.minIntervalMs ?? 150;
    this.itemsPerSecond = opts.itemsPerSecond ?? 50;
    this.maxAttempts = opts.maxAttempts ?? 8;
    this.backoffBaseMs = opts.backoffBaseMs ?? 1_000;
    this.backoffMaxMs = opts.backoffMaxMs ?? 60_000;
    this.log = opts.log ?? (() => {});
    this.client = makeClient(opts.url ?? RPC_URL, this.batchSize, opts.timeoutMs ?? 90_000);
  }

  /**
   * Resolve once the previous request's reservation elapsed since that request *completed*:
   * max(minIntervalMs, items / itemsPerSecond) x paceFactor. Measured 2026-09-30: 20-item batches spaced
   * 400 ms end-to-start never hit 429, while start-to-start spacing did about half of the time.
   * Serialised, so concurrent callers queue up instead of bursting.
   */
  private throttle(items: number): Promise<void> {
    const next = this.gate.then(async () => {
      const wait = this.lastRequestAt + this.reservedMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastRequestAt = Date.now();
      this.reservedMs = Math.ceil(Math.max(this.minIntervalMs, (items * 1000) / this.itemsPerSecond) * this.paceFactor);
    });
    this.gate = next.catch(() => {});
    return next;
  }

  /**
   * Run one JSON-RPC call (or one batch of `items` concurrent calls, which the transport merges into a
   * single HTTP request) with pacing and backoff. "log-range" and "fatal" errors are thrown to the caller
   * at once.
   */
  async call<T>(label: string, fn: () => Promise<T>, items = 1): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      await this.throttle(items);
      this.stats.requests++;
      this.stats.items += items;
      try {
        const out = await fn();
        this.lastRequestAt = Date.now();
        this.paceFactor = Math.max(1, this.paceFactor * 0.97);
        return out;
      } catch (err) {
        this.lastRequestAt = Date.now();
        const kind = classifyError(err);
        if (kind === "fatal" || kind === "log-range" || attempt + 1 >= this.maxAttempts) throw err;
        if (kind === "rate-limit") {
          this.stats.rateLimited++;
          this.paceFactor = Math.min(8, this.paceFactor * 1.5);
        }
        this.stats.retries++;
        const delay = backoffDelay(attempt, kind === "rate-limit" ? this.backoffBaseMs : this.backoffBaseMs / 2, this.backoffMaxMs);
        this.log(`${label}: ${kind} (${shortMessage(err)}); retry ${attempt + 1}/${this.maxAttempts - 1} in ${delay} ms`);
        await sleep(delay);
      }
    }
  }

  /** Map `fn` over `items`, `batchSize` concurrent calls per HTTP request, one paced request after another. */
  async batch<I, O>(label: string, items: readonly I[], fn: (item: I) => Promise<O>, onChunk?: (done: number, total: number) => void): Promise<O[]> {
    const out: O[] = [];
    for (let i = 0; i < items.length; i += this.batchSize) {
      const chunk = items.slice(i, i + this.batchSize);
      const results = await this.call(`${label}[${i}..${i + chunk.length - 1}]`, () => Promise.all(chunk.map(fn)), chunk.length);
      out.push(...results);
      onChunk?.(out.length, items.length);
    }
    return out;
  }

  /** Adaptive-window eth_getLogs. `fetch` performs one getLogs over [from, to]. */
  async *scanLogs<T>(opts: ScanOptions, fetch: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>): AsyncGenerator<ScanChunk<T>> {
    const label = opts.label ?? "getLogs";
    const minWindow = opts.minWindow ?? 1_000n;
    const maxWindow = opts.maxWindow ?? 8_000_000n;
    const sparse = opts.sparseThreshold ?? 2_000;
    const backward = opts.direction === "backward";
    let window = opts.initialWindow ?? 2_000_000n;
    let cur = backward ? opts.toBlock : opts.fromBlock;
    while (backward ? cur >= opts.fromBlock : cur <= opts.toBlock) {
      let start: bigint;
      let end: bigint;
      if (backward) {
        end = cur;
        start = cur - window + 1n > opts.fromBlock ? cur - window + 1n : opts.fromBlock;
      } else {
        start = cur;
        end = cur + window - 1n < opts.toBlock ? cur + window - 1n : opts.toBlock;
      }
      let logs: T[];
      try {
        logs = await this.call(`${label} ${start}..${end}`, () => fetch(start, end));
      } catch (err) {
        const kind = classifyError(err);
        if ((kind === "log-range" || kind === "transient") && window > minWindow) {
          window = window / 2n > minWindow ? window / 2n : minWindow;
          this.log(`${label}: ${kind} at ${start}..${end} (${shortMessage(err)}); window -> ${window}`);
          continue;
        }
        throw err;
      }
      yield { fromBlock: start, toBlock: end, window, logs };
      cur = backward ? start - 1n : end + 1n;
      if (logs.length < sparse && window < maxWindow) window = window * 2n < maxWindow ? window * 2n : maxWindow;
    }
  }
}
