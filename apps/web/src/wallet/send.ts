/**
 * Sends a prepared protocol transaction through the injected wallet and waits for its
 * receipt on the public RPC. The UI never calls this in demo or visitor mode; the care
 * flow will be wired to it once packages/core's steward produces `PreparedTx`s.
 */
import { createPublicClient, http, numberToHex, type Address, type EIP1193Provider, type Hex, type TransactionReceipt } from "viem";
import { RPC_URL, type PreparedTx } from "@nest/core";
import { CHAIN_ID_HEX, ensureChain } from "./eip1193.js";
import { robinhoodChain } from "./chain.js";

export const publicClient = createPublicClient({ chain: robinhoodChain, transport: http(RPC_URL) });

export interface SendResult {
  hash: Hex;
  receipt: TransactionReceipt;
}

export async function sendTransaction(provider: EIP1193Provider, from: Address, tx: PreparedTx): Promise<SendResult> {
  await ensureChain(provider);
  const hash = (await provider.request({
    method: "eth_sendTransaction",
    params: [{ from, to: tx.to, data: tx.data, value: numberToHex(tx.value), chainId: CHAIN_ID_HEX }],
  })) as Hex;
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`Transaction reverted: ${hash}`);
  return { hash, receipt };
}
