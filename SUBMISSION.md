![Nest: Mismir, a Friend hatched through Nest on mainnet, then the Ledger (VIA NEST) and a simulated feed in the demo](https://raw.githubusercontent.com/floflo777/rarefriends-nest/main/docs/media/nest.gif)

**Project name**
Nest

**Builder / contact**
[@floflo777](https://github.com/floflo777) · contact via GitHub issues

**Category**
Character Spotlight (primary), Token Activity, Economy Potential

**One sentence**
Nest is a three-button handheld pet whose body is your Rare Friend's own ERC-6551 wallet: feeding it is the protocol's real `claim()`, training it is `upgrade()`, raising it is `promote()`, hatching a pup is `hardwire()`, so caring for the pet is burning $RAREFRIENDS through the protocol itself.

**Evidence at a glance**
- **Real-wallet playthrough on mainnet, through the deployed UI:** a fresh wallet with no Friend hatched two Gen-5s, trained one, saved RF into its wallet, hatched a Gen-6 pup, fed, withdrew and raised the pup to Gen-5. 14 transactions, **17.5 RF burned by the protocol via Nest**, every hash re-verified from the chain: [docs/real-wallet.md](https://github.com/floflo777/rarefriends-nest/blob/main/docs/real-wallet.md).
- **Burn attributable by anyone:** every transaction Nest prepares ends with a 6-byte tag the contracts ignore; the indexer counts burns whose transaction carries it. Ledger today: VIA NEST 17.5 RF, 5 burn events; indexed total burn matches the RF supply to 0.000%.
- **No new purchase, no contract:** every paid action is one rarefriends.com already sells, at the protocol's price, 50% burned and 50% streamed to active Friends. Nest deploys nothing, holds no key, runs no chance table. For judges without a wallet, the demo household is the simulated MVP, with every action labelled SIMULATED and dry-run on chain from real owners.

**What did you build?**
A handheld virtual pet, three buttons and a 96×64 LCD, where the pet is your Rare Friend and its body is the NFT's real ERC-6551 wallet. Hunger is the RF and WETH it has not claimed. Strength is its tier. Territory is its generation. Savings is what sits in its wallet. Feeding it is `claim()`. Training it is `upgrade()`. Moving it to a bigger territory is `promote()`. Hatching the egg in your wallet is `hardwire()` at the generation your balance selects (1 RF for Gen-6 up to 100,000 RF for Gen-1). Waking a Genesis is `activate()`. Save parks RF in the pet's wallet so the next egg hatches cheaper; Withdraw takes it back through the wallet's ERC-6551 `execute`. Every paid care action is a real Rare Friends protocol call, 50% burned and 50% streamed to every active Friend, exactly as the protocol does it. Nest deploys no contract, holds no key, and simulates nothing it reports.

**The pet's character, all derived from chain state**
Two people looking at the same Friend see the same pet, because every trait is a pure function of what the chain says (`familyOf`, `seedOf`, generation, tier, `earned()`, wallet balances, indexed burns); only the tables are authored.
- **Name and voice:** 2–3 syllables from its family's syllable table, picked by its seed (Masks sound hushed: *Mismir*; Colossi heavy; Cellulars clicky). It says one line per family and mood, new every UTC hour ("Behind the mask: calm.", "Cannot sit still.").
- **Temperament by family:** nine temperaments, and they change behaviour, not just text: a Hoverer gets hungry at 20% unclaimed, a Skeleton only at 60% (it hides hunger).
- **Moods from vitals and the clock:** asleep (inactive, or its bedtime, 12 h opposite a favourite hour picked by its seed, unless starving), restless (paces across the screen), hungry (glances at the bowl, the bowl flickers), proud (star blinks for a day after a real upgrade or promote), thrifty (its own wallet grew since you last looked), sleepy, content. Each mood sets the clip and speed of the NFT's own 64 on-chain frames.
- **It grows:** the sprite and its patch of land get bigger with generation; the Home screen is the NFT's own `tokenURI` scene, which changes when the Friend is raised.
- **It reacts to care:** eating when fed, training, moving house when raised, an egg cracking into a pup on hatch, waking, saving. The reaction plays once the transaction lands.
- **Real examples, hatched through Nest on mainnet:** #344030 *Mismir* (Mask: "Secretive. Watches from behind the mask", favourite hour 16:00 UTC, secret habit "practises three different laughs"), #344033 *Fenjo* (Asymmetry: "Quirky. Does everything slightly sideways"), #344034 *Ditto* (Cellular: "Restless. Never sits still"). Check any of them with `npx tsx apps/cli/src/nest.ts state gen 344030` or the visitor links below.

**How does it use Rare Friends or $RAREFRIENDS?**
It uses only the existing protocol: Generations, Genesis, ActivationManager, the families registry (the NFT's 64 on-chain frames, rendered unaltered) and RF. Every RF that Nest reports burned left the supply through ActivationManager; the Burn Ledger and Nest Rank are indexed from the chain (`Transfer(ActivationManager → 0x0)`, attributed to the sender and, where the selector is known, the function; coverage is shown on screen). The Home screen renders the NFT's own `tokenURI` scene. Every transaction Nest prepares carries a 6-byte calldata tag the contracts ignore, so the RF burned through Nest is countable on chain by anyone (Ledger: "via Nest" 17.5 RF after the real-wallet playthrough). The Steward shows, before every payment, what it costs, what is burned, what goes to rewards, and in how many weeks the extra weight pays for it at the live stream.

**Source repository**
https://github.com/floflo777/rarefriends-nest · TypeScript, viem, React, Vite PWA. FriendSDK not used: Nest needs signed protocol transactions, which the SDK sandbox forbids by design; its ownership-gate rule (fresh-block `ownerOf` + `generation ≥ 1`) is reimplemented.

**Playable preview / demo**
- Handheld: https://floflo777.github.io/rarefriends-nest/
- Visitor mode, no wallet: https://floflo777.github.io/rarefriends-nest/?p=/pet/gen/1969 — any Friend by id, read-only (also https://floflo777.github.io/rarefriends-nest/?p=/pet/genesis/597)
- Demo, no gas: https://floflo777.github.io/rarefriends-nest/?p=/demo — a simulated household built from real Friends, every action labelled SIMULATED, including WAKE of a real sleeping Genesis (#929) dry-run on chain from its owner
- Ledger: https://floflo777.github.io/rarefriends-nest/?p=/ledger (VIA NEST 17.5 RF)
- Friends hatched through Nest on mainnet: https://floflo777.github.io/rarefriends-nest/?p=/pet/gen/344030 (Mismir, trained to tier 1) and https://floflo777.github.io/rarefriends-nest/?p=/pet/gen/344034 (Ditto, hatched as a Gen-6 pup, raised to Gen-5)
- Pet card (PNG): https://floflo777.github.io/rarefriends-nest/?p=/card/gen/1969
- Agents: `git clone https://github.com/floflo777/rarefriends-nest && npm ci && npx tsx apps/cli/src/nest.ts state gen 1969` (also `state genesis 597`, `meta gen 1969`, `plan <address> --dry-run`, `census`)
Wallet requirements for real care: an injected wallet (MetaMask, Rabby) on Robinhood Chain (4663) owning a hardwired Generations NFT or a Genesis; ETH for gas; RF for paid actions.

**How to use it**
◄ ► move, ● confirm. Screens: Pet, Home (the on-chain tokenURI scene), Stats, Care (Feed, Train, Raise, Hatch, Wake, Save, Withdraw), Household, Rank, Ledger. Every paid action shows exact RF cost, burn 50%, rewards 50% and break-even before the wallet signs; a Raise of a trained Friend states that the tier resets and what is not refunded; claims under 0.5 RF are flagged as not worth gas yet. Keyboard, touch, reduced motion and mute supported.

**Costs, outcomes, rewards**
Real, set by the protocol: hatch = the generation your balance selects (1 RF for Gen-6 up to 100,000 RF for Gen-1); promotions 9 / 90 / 900 / 9,000 / 90,000 RF; tier upgrades per the protocol tables; Genesis activation 100,000 RF. Always 50% burned, 50% to the 7-day reward stream into every active Friend's wallet. No chance, no house, no consumables. Break-even is read live: the RF stream rolled from 8,547,984 to 193,586 RF per week at 18:07 UTC on submission day, which moved Genesis activation from 6.3 to 275 weeks and every Generations action from 61–114 to about 2,700–5,000 weeks. The handheld showed the new figures within the block (e.g. "TRAIN #344030 → TIER 1 · BREAK-EVEN 4,309 WK") and says on every paid confirmation: "THIS IS A COLLECTOR'S SPEND, NOT A YIELD PLAY" (docs/economics.md).

**Checks**
Typecheck clean; 188 unit tests pass across core, web and indexer (6 live-RPC tests skipped by default). Dry-run of every action from real holders' addresses via eth_simulateV1: docs/dry-run.md. Live smoke tests against the public RPC. Real-wallet playthrough: done on mainnet on 2026-09-30, 14 transactions through the deployed UI, desktop Chromium driven by Playwright with an injected wallet (docs/real-wallet.md, with the harness). Not yet done on a phone by hand. Wake (Genesis `activate`, 100,000 RF) is dry-run only, from a real sleeping Genesis's owner (docs/dry-run.md).

**Known limitations**
Injected wallets only (no WalletConnect). The public RPC rate-limits; the app batches and backs off. Personality tables are authored by us; their inputs are all chain state. Break-evens assume the current stream continues. Fully autonomous Steward (delegate contract) is specified in docs/delegate.md and not deployed.

**Credits**
Canonical on-chain artwork by Rare Friends, unaltered. No third-party assets.
