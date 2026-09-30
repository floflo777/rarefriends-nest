import { defineChain } from "viem";
import { CHAIN_ID, EXPLORER_URL, RPC_URL } from "@nest/core";

export const robinhoodChain = defineChain({
  id: CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "Blockscout", url: EXPLORER_URL } },
});
