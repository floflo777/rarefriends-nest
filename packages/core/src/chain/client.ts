/**
 * viem PublicClient for Robinhood Chain (4663), read-only. Nest never sends a
 * transaction: this module only exposes reads, multicall and a retry helper for the
 * public RPC's rate limit (HTTP 429 around 100 calls/s, JSON batches > 50 rejected).
 */
import { createPublicClient, defineChain, http, BaseError, HttpRequestError, LimitExceededRpcError } from "viem";
import type { PublicClient, Transport } from "viem";
import { ADDRESSES, CHAIN_ID, EXPLORER_URL, RPC_URL } from "../protocol/constants.js";

export const robinhoodChain = defineChain({
  id: CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "Blockscout", url: EXPLORER_URL } },
  contracts: { multicall3: { address: ADDRESSES.multicall3 } },
});

export type NestClient = PublicClient<Transport, typeof robinhoodChain>;

export interface NestClientOptions {
  /** Defaults to the public RPC. Ignored when `transport` is given. */
  rpcUrl?: string;
  /** Custom transport (tests, private RPC). */
  transport?: Transport;
}

/** JSON-RPC batch size kept under the public RPC's limit of 50 requests per batch. */
export const RPC_BATCH_SIZE = 40;
/** Multicall3 aggregate3 calldata per eth_call (bytes); ~120 typical view calls. */
export const MULTICALL_BATCH_BYTES = 16_384;

export function createNestClient(options: NestClientOptions = {}): NestClient {
  const transport =
    options.transport ??
    http(options.rpcUrl ?? RPC_URL, {
      batch: { batchSize: RPC_BATCH_SIZE, wait: 16 },
      retryCount: 4,
      retryDelay: 400,
      timeout: 30_000,
    });
  return createPublicClient({
    chain: robinhoodChain,
    transport,
    batch: { multicall: { batchSize: MULTICALL_BATCH_BYTES, wait: 16 } },
    pollingInterval: 4_000,
  });
}

export interface RetryOptions {
  /** Attempts after the first one. Default 5. */
  retries?: number;
  /** First back-off delay; doubles each attempt with jitter. Default 500 ms. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Defaults to `isRateLimitError`. */
  isRetryable?: (error: unknown) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

/** Walks `error.cause` chains (viem wraps errors several levels deep). */
export function* errorChain(error: unknown): Generator<unknown> {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    yield current;
    current = typeof current === "object" && "cause" in current ? (current as { cause?: unknown }).cause : undefined;
  }
}

export function errorMessages(error: unknown): string {
  const parts: string[] = [];
  for (const e of errorChain(error)) {
    if (e instanceof BaseError) parts.push(e.shortMessage, e.details);
    else if (e instanceof Error) parts.push(e.message);
    else if (typeof e === "string") parts.push(e);
  }
  return parts.filter((p) => p.length > 0).join(" | ");
}

export function isRateLimitError(error: unknown): boolean {
  for (const e of errorChain(error)) {
    if (e instanceof HttpRequestError && e.status === 429) return true;
    if (e instanceof LimitExceededRpcError) return true;
  }
  return /\b429\b|rate limit|too many requests/i.test(errorMessages(error));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retries `fn` with exponential back-off while `isRetryable(error)` (default: HTTP 429). */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const retries = options.retries ?? 5;
  const base = options.baseDelayMs ?? 500;
  const max = options.maxDelayMs ?? 10_000;
  const isRetryable = options.isRetryable ?? isRateLimitError;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= retries || !isRetryable(error)) throw error;
      const delay = Math.min(max, base * 2 ** attempt) * (0.75 + Math.random() * 0.5);
      options.onRetry?.(error, attempt + 1, delay);
      await sleep(delay);
    }
  }
}
