/**
 * What the handheld needs from a connected wallet, as one small interface: the ownership
 * gate, the dry-run and the send. Core does the reads and the simulation; the wallet only
 * signs. Tests substitute a fake client.
 */
import type { Address, EIP1193Provider, Hex } from "viem";
import { dryRunAll, readEligibility, type DryRunResult, type Eligibility, type Friend, type NestClient, type PreparedTx } from "@nest/core";
import { sendTransaction } from "./send.js";

export interface ChainActions {
  account: Address;
  /** eth_simulateV1 (or eth_call + eth_estimateGas) of the prepared txs from `account`. Nothing is sent. */
  dryRun(txs: PreparedTx[]): Promise<DryRunResult[]>;
  /** FriendSDK's rule at a fresh block: ownerOf == account and generation >= 1. */
  eligibility(friend: Pick<Friend, "collection" | "tokenId">): Promise<Eligibility>;
  /** Signs and sends one tx; `onSent` gets the hash before the receipt is awaited. */
  send(tx: PreparedTx, onSent: (hash: Hex) => void): Promise<Hex>;
  /** Called once a run has landed so cached reads are dropped. */
  settled?: () => void;
}

export function createChainActions(client: NestClient, provider: EIP1193Provider, account: Address, settled?: () => void): ChainActions {
  const actions: ChainActions = {
    account,
    dryRun: (txs) => dryRunAll(client, account, txs),
    eligibility: (friend) => readEligibility(client, account, friend.collection, friend.tokenId),
    send: (tx, onSent) => sendTransaction(provider, client, account, tx, onSent),
  };
  if (settled) actions.settled = settled;
  return actions;
}
