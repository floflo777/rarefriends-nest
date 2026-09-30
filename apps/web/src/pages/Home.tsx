import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Address } from "viem";
import { liveSource, nestClient, useDataSource } from "../data/context.jsx";
import { Device } from "../device/Device.jsx";
import { shortAddress } from "../model/format.js";
import { createChainActions } from "../wallet/actions.js";
import { useWallet } from "../wallet/useWallet.jsx";

export const GITHUB_URL = "https://github.com/floflo777/rarefriends-nest";

/** The Friend on the landing page: a real Gen-1, read live, no wallet involved. */
export const SHOWCASE_FRIEND = { collection: "Generations", tokenId: 1969n } as const;

function LookupForm() {
  const navigate = useNavigate();
  const [tokenId, setTokenId] = useState("");
  const [collection, setCollection] = useState<"gen" | "genesis">("gen");
  const valid = /^\d{1,12}$/.test(tokenId);

  const visit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) navigate(`/pet/${collection}/${tokenId}`);
  };

  return (
    <form className="visitor" onSubmit={visit} aria-label="Look up a Friend">
      <label htmlFor="collection">Collection</label>
      <select id="collection" value={collection} onChange={(e) => setCollection(e.target.value as "gen" | "genesis")}>
        <option value="gen">Generations</option>
        <option value="genesis">Genesis</option>
      </select>
      <label htmlFor="tokenId">Token id</label>
      <input id="tokenId" inputMode="numeric" pattern="\d*" placeholder="1969" value={tokenId} onChange={(e) => setTokenId(e.target.value.trim())} />
      <button type="submit" className="secondary" disabled={!valid}>
        Look up a Friend
      </button>
    </form>
  );
}

function Landing() {
  const wallet = useWallet();
  const source = useDataSource();

  return (
    <main className="landing">
      <header className="landing-head">
        <h1>Nest</h1>
        <p className="tagline">A handheld pet whose body is your Rare Friend's real wallet.</p>
      </header>

      <Device
        source={source}
        mode="visitor"
        target={{ kind: "friend", collection: SHOWCASE_FRIEND.collection, tokenId: SHOWCASE_FRIEND.tokenId }}
        footer={
          <p className="small showcase-note">
            Friend #1969, read live from Robinhood Chain. No wallet needed. <Link to="/pet/gen/1969">Open it</Link>
          </p>
        }
      />

      <p className="lede">
        Every vital is chain state (unclaimed rewards, tier, generation) and every care action is a real Rare Friends protocol call, priced, split into burn and
        stream, and dry-run before your wallet is asked.
      </p>

      <div className="actions">
        <Link className="button primary" to="/demo">
          Try the demo (no wallet)
        </Link>
      </div>
      <LookupForm />
      <div className="actions">
        <button type="button" className="tertiary" onClick={() => void wallet.connect()} disabled={wallet.connecting}>
          {wallet.connecting ? "Connecting..." : "Connect wallet · Robinhood Chain"}
        </button>
      </div>
      {wallet.error && <p className="error">{wallet.error}</p>}
      <p className="small">
        <Link to="/ledger">Ledger</Link> · <a href={GITHUB_URL}>GitHub</a>
      </p>
    </main>
  );
}

function Connected({ address }: { address: Address }) {
  const source = useDataSource();
  const wallet = useWallet();
  const provider = wallet.provider;
  const chain = useMemo(
    () => (provider ? createChainActions(nestClient, provider, address, () => liveSource.invalidateHousehold(address)) : undefined),
    [provider, address],
  );
  return (
    <main className="page">
      <Device
        source={source}
        mode="wallet"
        target={{ kind: "household", owner: address }}
        {...(chain ? { chain } : {})}
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
