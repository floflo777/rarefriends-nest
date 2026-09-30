# Nest

**Your Rare Friend's wallet is the pet.**

Nest is a handheld virtual pet for [Rare Friends](https://rarefriends.com) on Robinhood Chain. The pet is your Generations (or Genesis) NFT. Its body is the NFT's real ERC-6551 wallet. Its hunger is the rewards it has not claimed. Feeding it is `claim()`. Training it is `upgrade()`. Moving it to a bigger territory is `promote()`. Hatching an egg is `hardwire()` at the generation your balance selects, 1 RF for Gen-6 up to 100,000 RF for Gen-1 (Save parks RF in a pet's wallet to hatch a cheaper pup on purpose; Withdraw takes it back). Every paid care action is a real Rare Friends protocol action, 50% burned and 50% streamed to every active Friend, exactly as the protocol does it. Nest deploys no contract, holds no key, and simulates nothing it reports.

- Design: [docs/design.md](docs/design.md)
- Economics, with the chain's own numbers: [docs/economics.md](docs/economics.md)
- Dry-run proofs of every action: [docs/dry-run.md](docs/dry-run.md)
- Steward delegate, specified and not deployed: [docs/delegate.md](docs/delegate.md)

## Try it

Live: https://floflo777.github.io/rarefriends-nest/

- **Visitor mode, no wallet:** `/pet/gen/1969` shows any Friend read-only.
- **Demo, no gas:** `/demo` is a simulated household built from a real snapshot; every action is labelled SIMULATED.
- **Your household:** connect an injected wallet on Robinhood Chain (4663) holding a hardwired Generations NFT or a Genesis.
- **Agents and judges:** `npx tsx apps/cli/src/nest.ts state gen 1969`, `… state genesis 597`, `… meta gen 1969` (the NFT's own tokenURI), `… household 0x…`, `… plan 0x… --dry-run`, `… census` (after `npm ci`).

## Run

```sh
npm ci
npm run build
npm run dev -w @nest/web      # http://localhost:5173
npm run index -w @nest/indexer  # rebuild apps/web/public/data/snapshot.json from the chain
npm test
```

Node 22+. No environment variables, no API keys: everything reads the public RPC `https://rpc.mainnet.chain.robinhood.com`.

## Layout

```
packages/core   chain reads, protocol maths, steward planner + dry-run, sprites, personality, vitals
apps/web        the handheld (Vite + React PWA)
apps/cli        `nest` command for agents
tools/indexer   throttled public-RPC indexer → static snapshot (burn ledger, ranks, censuses)
docs/           design, economics, dry-run, delegate
```

## Licence

Apache-2.0 for the code. The on-chain artwork belongs to Rare Friends and is displayed unaltered.
