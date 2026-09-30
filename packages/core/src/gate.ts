/**
 * Ownership gate, the FriendSDK rule reimplemented: at a fresh block, `ownerOf(id)`
 * must equal the account and, for Generations, `generation(id) >= 1`.
 */
import { isAddressEqual } from "viem";
import type { Address, ContractFunctionParameters } from "viem";
import type { Collection } from "./types.js";
import { GENERATIONS_ABI, GENESIS_ABI } from "./protocol/constants.js";
import { withRetry } from "./chain/client.js";
import type { NestClient } from "./chain/client.js";
import { collectionAddress } from "./chain/reads.js";

export interface Eligibility {
  eligible: boolean;
  reason: string;
  blockNumber: bigint;
  owner?: Address;
  generation?: number;
}

export async function readEligibility(client: NestClient, account: Address, collection: Collection, tokenId: bigint): Promise<Eligibility> {
  const blockNumber = await withRetry(() => client.getBlockNumber({ cacheTime: 0 }));
  const address = collectionAddress(collection);
  const contracts: ContractFunctionParameters[] =
    collection === "Generations"
      ? [
          { address, abi: GENERATIONS_ABI, functionName: "ownerOf", args: [tokenId] },
          { address, abi: GENERATIONS_ABI, functionName: "generation", args: [tokenId] },
        ]
      : [{ address, abi: GENESIS_ABI, functionName: "ownerOf", args: [tokenId] }];
  const results = await withRetry(() => client.multicall({ contracts, allowFailure: true, blockNumber }));

  const ownerResult = results[0];
  const genResult = results[1];
  const generation = genResult !== undefined && genResult.status === "success" && typeof genResult.result === "number" ? genResult.result : undefined;
  const withGen = (e: Eligibility): Eligibility => (generation !== undefined ? { ...e, generation } : e);

  if (ownerResult === undefined || ownerResult.status !== "success" || typeof ownerResult.result !== "string") {
    const reason =
      collection === "Generations" && generation === 0
        ? `Generations #${tokenId} is a temporary Friend (generation 0): hardwire it first`
        : `${collection} #${tokenId} has no owner (ownerOf reverted at block ${blockNumber})`;
    return withGen({ eligible: false, reason, blockNumber });
  }
  const owner = ownerResult.result as Address;
  if (!isAddressEqual(owner, account)) {
    return withGen({ eligible: false, reason: `${collection} #${tokenId} is owned by ${owner}, not ${account}`, blockNumber, owner });
  }
  if (collection === "Generations" && (generation === undefined || generation < 1)) {
    return withGen({ eligible: false, reason: `Generations #${tokenId} has generation ${generation ?? "unknown"}; needs >= 1`, blockNumber, owner });
  }
  return withGen({ eligible: true, reason: `owner matches at block ${blockNumber}`, blockNumber, owner });
}
