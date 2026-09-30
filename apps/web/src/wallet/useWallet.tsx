import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Address, EIP1193Provider } from "viem";
import { CHAIN_ID } from "@nest/core";
import { currentAccounts, currentChainId, ensureChain, getInjectedProvider, onAccountsChanged, onChainChanged, requestAccounts } from "./eip1193.js";

export interface WalletState {
  provider: EIP1193Provider | null;
  address: Address | null;
  chainId: number | null;
  onRightChain: boolean;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  switchChain: () => Promise<void>;
  disconnect: () => void;
}

const Ctx = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [provider] = useState<EIP1193Provider | null>(() => getInjectedProvider());
  const [address, setAddress] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!provider) return;
    void currentAccounts(provider).then((a) => setAddress(a[0] ?? null), () => undefined);
    void currentChainId(provider).then(setChainId, () => undefined);
    const offA = onAccountsChanged(provider, (a) => setAddress(a[0] ?? null));
    const offC = onChainChanged(provider, setChainId);
    return () => {
      offA();
      offC();
    };
  }, [provider]);

  const connect = useCallback(async () => {
    if (!provider) {
      setError("No injected wallet found. Install a browser wallet or use visitor mode.");
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const accounts = await requestAccounts(provider);
      setAddress(accounts[0] ?? null);
      await ensureChain(provider);
      setChainId(await currentChainId(provider));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  }, [provider]);

  const switchChain = useCallback(async () => {
    if (!provider) return;
    try {
      await ensureChain(provider);
      setChainId(await currentChainId(provider));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [provider]);

  const disconnect = useCallback(() => setAddress(null), []);

  const value = useMemo<WalletState>(
    () => ({ provider, address, chainId, onRightChain: chainId === CHAIN_ID, connecting, error, connect, switchChain, disconnect }),
    [provider, address, chainId, connecting, error, connect, switchChain, disconnect],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet outside WalletProvider");
  return v;
}
