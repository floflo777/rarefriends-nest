**Project name**
Nest

**Builder / contact**
floflo777 (GitHub) · Telegram: (fill in)

**Category**
Character Spotlight (primary), Token Activity, Economy Potential

**What did you build?**
A handheld virtual pet, three buttons and a 96×64 LCD, where the pet is your Rare Friend and its body is the NFT's real ERC-6551 wallet. Hunger is the RF and WETH it has not claimed. Strength is its tier. Territory is its generation. Savings is what sits in its wallet. Feeding it is `claim()`. Training it is `upgrade()`. Moving it to a bigger territory is `promote()`. Hatching the egg in your wallet is `hardwire()`. Waking a Genesis is `activate()`. Every care action is a real Rare Friends protocol call, 50% burned and 50% streamed to every active Friend, exactly as the protocol does it. Nest deploys no contract, holds no key, and simulates nothing it reports.

**How does it use Rare Friends or $RAREFRIENDS?**
It uses only the existing protocol: Generations, Genesis, ActivationManager, the families registry (the NFT's 64 on-chain frames, rendered unaltered) and RF. Every RF that Nest reports burned left the supply through ActivationManager; the Burn Ledger and Nest Rank are indexed from the chain (`Transfer(ActivationManager → 0x0)`, attributed to the sender and function). The Steward shows, before every payment, what it costs, what is burned, what goes to rewards, and in how many weeks the extra weight pays for it at the live stream.

**Source repository**
https://github.com/floflo777/rarefriends-nest · TypeScript, viem, React, Vite PWA. FriendSDK not used: Nest needs signed protocol transactions, which the SDK sandbox forbids by design; its ownership-gate rule (fresh-block `ownerOf` + `generation ≥ 1`) is reimplemented.

**Playable preview / demo**
- Handheld: https://floflo777.github.io/rarefriends-nest/
- Visitor mode, no wallet: https://floflo777.github.io/rarefriends-nest/pet/gen/1969 — any Friend by id, read-only (also /pet/genesis/597)
- Demo, no gas: https://floflo777.github.io/rarefriends-nest/demo — a simulated household built from real Friends, every action labelled SIMULATED
- Ledger: https://floflo777.github.io/rarefriends-nest/ledger
- Agents: `git clone https://github.com/floflo777/rarefriends-nest && npm ci && npx tsx apps/cli/src/nest.ts state gen 1969` (also `plan <address> --dry-run`, `census`)
Wallet requirements for real care: an injected wallet (MetaMask, Rabby) on Robinhood Chain (4663) owning a hardwired Generations NFT or a Genesis; ETH for gas; RF for paid actions.

**How to use it**
◄ ► move, ● confirm. Screens: Pet, Stats, Care (Feed, Train, Raise, Hatch, Wake, Save), Household, Rank, Ledger. Every paid action shows exact RF cost, burn 50%, rewards 50% and break-even before the wallet signs. Keyboard, touch, reduced motion and mute supported.

**Costs, outcomes, rewards**
Real, set by the protocol: hatch = the generation your balance selects (1 RF for Gen-6 up to 100,000 RF for Gen-1); promotions 9 / 90 / 900 / 9,000 / 90,000 RF; tier upgrades per the protocol tables; Genesis activation 100,000 RF. Always 50% burned, 50% to the 7-day reward stream into every active Friend's wallet. No chance, no house, no consumables. Break-even at the 2026-09-30 stream: Genesis activation 6.3 weeks; every Generations action 66–114 weeks. Nest says so on the confirmation.

**Checks**
Typecheck and unit tests across core, web, CLI and indexer (see README). Dry-run of every action from real holders' addresses via eth_simulateV1: docs/dry-run.md. Live smoke tests against the public RPC. Real-wallet playthrough: (fill in: done / pending).

**Known limitations**
Injected wallets only (no WalletConnect). The public RPC rate-limits; the app batches and backs off. Personality tables are authored by us; their inputs are all chain state. Break-evens assume the current stream continues. Fully autonomous Steward (delegate contract) is specified in docs/delegate.md and not deployed.

**Credits**
Canonical on-chain artwork by Rare Friends, unaltered. No third-party assets.
