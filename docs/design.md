# Nest — design

**One sentence.** Nest is a handheld virtual pet for Rare Friends where the pet is your Generations (or Genesis) NFT, its body is the NFT's real ERC-6551 wallet, and every care action is a real Rare Friends protocol action.

Rare Friends describes itself as "a virtual-pet protocol for NFTs that collect crypto". Nest is that pet, literally.

## Why this and not another minigame

The protocol already has a sink: hardwire, promote, upgrade and activate each burn 50% of the RF paid and stream the other 50% to every active Friend over 7 days. It is a one-shot form on a website. Nothing gives a holder a reason to come back, a goal, a comparison with other holders, or a feeling that the Friend is alive. Nest supplies exactly that layer and nothing else. It does not invent a second economy, does not deploy contracts, and does not simulate burns: every RF that Nest reports burned left the supply through the protocol itself.

Facts read from Robinhood Chain on 2026-09-30 (block ~76.46M), reproducible with `nest census`:

| Fact | Value |
|---|---|
| Hardwired Friends since launch (block 64,590,957) | 62,333 by 3,738 wallets |
| By generation | Gen-6 40,703 · Gen-5 15,527 · Gen-4 4,218 · Gen-3 1,028 · Gen-2 335 · Gen-1 522 |
| RF burned to date | 76.26M of 1.024B (7.4%) |
| Current 7-day stream | 8,547,984 RF + 1.63 WETH |
| Total active weight | 1,068,713,094 |
| Observed burn rate (last ~14 h) | ~375k RF, all from ActivationManager |

Two consequences that shape the game:

1. **65% of all Friends are Gen-6 pups that nobody raised.** Promoting one Gen-6 to Gen-5 costs 9 RF and burns 4.5. The raise ladder (6→1) is 100,000 RF per Friend, 50,000 burned. That ladder is the largest RF sink that exists, and it is unused.
2. **Yield alone will not move Generations holders.** At today's stream, a Gen-6 tier upgrade pays for itself in ~106 weeks, a Gen-1 upgrade in ~66 weeks, a Genesis activation in ~6 weeks. Nest says so, out loud, in the Steward. The reasons to raise a Friend are the reasons people raise pets: it grows (on-chain art gains land with generation), it earns (weight ×~11 per generation), it is yours forever (NFT + wallet), and everyone can see what you did (rank by real burn).

## The player loop

Open Nest daily. The handheld shows your Friend:

| Vital | Chain read | Care action | Protocol call |
|---|---|---|---|
| Hunger | `earned(RF/WETH, collection, id)` unclaimed | Feed | `claim(asset, collection, id)` → NFT wallet |
| Strength | `positions(collection, id).tier` | Train | `upgrade(collection, id)` |
| Territory | `generation(id)` | Raise | `promote(id)` |
| Awake (Genesis) | `positions(...).weight > 0` | Wake | `activate(collection, id)` |
| Eggs | `temporaryFriend(owner)` | Hatch | `hardwire(6)` for 1 RF |
| Mood | weight ÷ `totalWeight()` and its trend | — | — |
| Savings | RF, WETH, ETH in `tokenBoundAccount(id)` | Withdraw (owner) | ERC-6551 `execute` |

Household = every Friend the wallet owns. Pups = Friends hatched from eggs. Raising a pup through generations is the mid-game; a maxed household is the end-game.

Nest Rank: leaderboard of households by real RF burned (indexed from RF `Transfer(from, 0x0)` events emitted by ActivationManager, attributed to the transaction sender and function selector). No local state anywhere. Nothing can be faked.

Every paid action opens a confirmation showing exact RF cost, RF burned (50%), RF to rewards (50%), and the Steward's break-even for that action. Then the wallet signs. Nest never holds a key.

## Personality

Everything the pet does is a pure function of `(family, seed, vitals, time)`:

- `familyOf(id)` (9 families) → temperament: how quickly hunger shows, idle habits, what it says.
- `seedOf(id)` → name, favourite hour, one secret habit.
- vitals → mood state: content, hungry, restless (rewards piling up), proud (recent promotion), sleepy, thrifty (savings grew).
- Sprite: the NFT's canonical 64 on-chain frames from the families registry (`frames(family, seed)`), rendered 1-bit on a 96×64 LCD. Colour mode shows the frames with the original palette and the on-chain `tokenURI` scene unaltered.

Tables are authored by us; inputs are all chain state, so two people looking at the same Friend see the same pet.

## Steward

For each Friend and each possible action: cost, Δweight, weekly RF at the current stream, break-even weeks. Ranks actions. Prepares `approve` + action calldata and dry-runs them (`eth_call` and `eth_estimateGas` from the holder's address) before the wallet is asked. CLI `nest plan <address>` prints the same plan as JSON for agents. Fully autonomous mode (a scoped delegate contract with allowed functions, spend cap and expiry) is specified in `docs/delegate.md` and not deployed.

## For judges without a Friend

- `/pet/<tokenId>`: any Friend, read-only, no wallet.
- `/demo`: a simulated household built from a real snapshot; actions animate locally and are labelled SIMULATED.
- `nest state <tokenId>` and `nest census` print chain-derived JSON.
- `docs/dry-run.md`: recorded `eth_call`/`eth_estimateGas` results for every action against real holders.

## Not in scope, deliberately

Chance games, cosmetics shops, new tokens, launchpads, our own contracts, push notifications, hardware. Each would dilute the one claim: the protocol's own economy, made into a pet you want to come back to.

## Stack

TypeScript everywhere. `packages/core` (viem reads, protocol maths, sprites, personality, steward; no DOM). `apps/web` (Vite + React PWA, injected EIP-1193 wallets, Robinhood Chain 4663). `apps/cli` (`nest`). `tools/indexer` (throttled public-RPC indexer, static snapshot JSON). FriendSDK is not used: Nest needs signed protocol transactions, which the SDK sandbox forbids by design; its ownership-gate rule (fresh-block `ownerOf` + `generation ≥ 1`) is reimplemented.
