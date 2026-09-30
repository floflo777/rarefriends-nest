/**
 * Sends a prepared protocol transaction through the injected wallet and waits for its
 * receipt on the public RPC (core's client). Only wallet mode reaches this; demo and
 * visitor mode never do.
 */
import { numberToHex, type Address, type EIP1193Provider, type Hex } from "viem";
import type { NestClient, PreparedTx } from "@nest/core";
import { CHAIN_ID_HEX, ensureChain } from "./eip1193.js";

/**
 * Prompts the wallet to switch to (or add) Robinhood Chain, asks it to sign and send `tx`,
 * reports the hash as soon as the wallet returns it, then waits for the receipt.
 */
export async function sendTransaction(provider: EIP1193Provider, client: NestClient, from: Address, tx: PreparedTx, onSent?: (hash: Hex) => void): Promise<Hex> {
  await ensureChain(provider);
  const hash = (await provider.request({
    method: "eth_sendTransaction",
    params: [{ from, to: tx.to, data: tx.data, value: numberToHex(tx.value), chainId: CHAIN_ID_HEX }],
  })) as Hex;
  onSent?.(hash);
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`Transaction reverted: ${hash}`);
  return hash;
}
