import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Address } from "viem";
import { useDataSource } from "../data/context.jsx";
import { Device } from "../device/Device.jsx";
import { shortAddress } from "../model/format.js";
import { useWallet } from "../wallet/useWallet.jsx";

function Landing() {
  const wallet = useWallet();
  const navigate = useNavigate();
  const [tokenId, setTokenId] = useState("");
  const [collection, setCollection] = useState<"gen" | "genesis">("gen");

  const visit = (e: FormEvent) => {
    e.preventDefault();
    if (/^\d{1,12}$/.test(tokenId)) navigate(`/pet/${collection}/${tokenId}`);
  };

  return (
    <main className="landing">
      <h1>Nest</h1>
      <p className="lede">A handheld virtual pet where your Rare Friend's wallet is the pet. Every care action is a real protocol action; nothing is simulated except the demo.</p>
      <div className="actions">
        <button type="button" className="primary" onClick={() => void wallet.connect()} disabled={wallet.connecting}>
          {wallet.connecting ? "Connecting..." : "Connect wallet"}
        </button>
        <Link className="button" to="/demo">
          Try the demo
        </Link>
      </div>
      {wallet.error && <p className="error">{wallet.error}</p>}
      <form className="visitor" onSubmit={visit}>
        <label htmlFor="collection">Collection</label>
        <select id="collection" value={collection} onChange={(e) => setCollection(e.target.value as "gen" | "genesis")}>
          <option value="gen">Generations</option>
          <option value="genesis">Genesis</option>
        </select>
        <label htmlFor="tokenId">Token id</label>
        <input id="tokenId" inputMode="numeric" pattern="\d*" placeholder="1969" value={tokenId} onChange={(e) => setTokenId(e.target.value.trim())} />
        <button type="submit">View as visitor</button>
      </form>
      <p className="small">
        <Link to="/ledger">Protocol ledger</Link>
      </p>
    </main>
  );
}

function Connected({ address }: { address: Address }) {
  const source = useDataSource();
  const wallet = useWallet();
  return (
    <main className="page">
      <Device
        source={source}
        mode="wallet"
        target={{ kind: "household", owner: address }}
        onAction={() => "Wallet signing is not wired yet"}
        footer={
          <nav className="under">
            <span className="addr" title={address}>
              {shortAddress(address)}
            </span>
            {!wallet.onRightChain && (
              <button type="button" onClick={() => void wallet.switchChain()}>
                Switch to Robinhood Chain
              </button>
            )}
            <button type="button" onClick={wallet.disconnect}>
              Disconnect
            </button>
            <Link to="/ledger">Ledger</Link>
          </nav>
        }
      />
    </main>
  );
}

export function HomePage() {
  const wallet = useWallet();
  return wallet.address ? <Connected address={wallet.address} /> : <Landing />;
}
