/** Minimal injected-provider (EIP-1193) connector. No WalletConnect, no key handling. */
import type { Address, EIP1193Provider, Hex } from "viem";
import { CHAIN_ID, EXPLORER_URL, RPC_URL } from "@nest/core";

export const CHAIN_ID_HEX: Hex = `0x${CHAIN_ID.toString(16)}`;

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export function getInjectedProvider(): EIP1193Provider | null {
  return typeof window !== "undefined" && window.ethereum ? window.ethereum : null;
}

export async function requestAccounts(provider: EIP1193Provider): Promise<Address[]> {
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as Address[];
  return accounts;
}

export async function currentAccounts(provider: EIP1193Provider): Promise<Address[]> {
  return (await provider.request({ method: "eth_accounts" })) as Address[];
}

export async function currentChainId(provider: EIP1193Provider): Promise<number> {
  const hex = (await provider.request({ method: "eth_chainId" })) as string;
  return parseInt(hex, 16);
}

/** Switch to Robinhood Chain, adding it first when the wallet does not know it (error 4902). */
export async function ensureChain(provider: EIP1193Provider): Promise<void> {
  if ((await currentChainId(provider)) === CHAIN_ID) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID_HEX }] });
  } catch (e) {
    const code = (e as { code?: number }).code;
    if (code !== 4902) throw e;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: CHAIN_ID_HEX,
          chainName: "Robinhood Chain",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: [RPC_URL],
          blockExplorerUrls: [EXPLORER_URL],
        },
      ],
    });
  }
}

export function onAccountsChanged(provider: EIP1193Provider, cb: (accounts: Address[]) => void): () => void {
  const handler = (accounts: readonly string[]) => cb(accounts as Address[]);
  provider.on("accountsChanged", handler);
  return () => provider.removeListener("accountsChanged", handler);
}

export function onChainChanged(provider: EIP1193Provider, cb: (chainId: number) => void): () => void {
  const handler = (hex: string) => cb(parseInt(hex, 16));
  provider.on("chainChanged", handler);
  return () => provider.removeListener("chainChanged", handler);
}
