# Nest — economics

All figures read from Robinhood Chain on 2026-09-30 (block ~76.46M). Reproduce with `nest census` and `nest plan`.

## What the protocol already does

| Action | Who pays | RF paid | Burned (50%) | To rewards (50%) | What the payer gets |
|---|---|---|---|---|---|
| Hardwire Gen-6 | any wallet holding ≥ 1 RF | 1 | 0.5 | 0.5 | a permanent NFT with its own wallet, weight 1.1 |
| Promote 6→5 / 5→4 / 4→3 / 3→2 / 2→1 | owner | 9 / 90 / 900 / 9,000 / 90,000 | half | half | weight ×~11 per step, on-chain world grows |
| Upgrade tier 0→1→2→3→4 (Gen g) | owner | 50% / 75% / 112.5% / 168.75% of the generation's price | half | half | weight ×1.54 / ×1.54 / ×1.54 / ×1.54 |
| Activate Genesis | owner | 100,000 | 50,000 | 50,000 | weight 2,000,000 |

Rewards: the 50% side plus 5% of WETH market fees stream over 7 days to every active Friend by weight. Rewards land in the NFT's own wallet and travel with the NFT when sold.

## What the chain says today

| Fact | Value |
|---|---|
| RF initial supply | 1,024,000,000 |
| RF supply now | 947,738,128 (76.26M burned, 7.4%) |
| Current stream | 8,547,984 RF + 1.63 WETH over 7 days |
| Total active weight | 1,068,713,094 |
| RF per weight-unit per week | 0.0080 |
| Hardwired Friends (since block 64,590,957) | 62,333 by 3,738 wallets |
| of which Gen-6 (1 RF, never raised) | 40,703 (65%) |
| Gen-5 / Gen-4 / Gen-3 / Gen-2 / Gen-1 | 15,527 / 4,218 / 1,028 / 335 / 522 |
| Observed burn, last ~14 h | 375,016 RF, 187 events, 100% via ActivationManager |
| Genesis | 495 activated · 118 inactive in holders' wallets · 411 in the reserve |

## Break-even, and why Nest never hard-codes it

The reward stream is re-set every 7 days. On 2026-09-30 at 18:07 UTC, during submission day, it rolled from **8,547,984 RF** to **193,586 RF** over 7 days (`streams(RF)` on ActivationManager: amount 193,586, periodFinish 2026-10-07 15:09 UTC; total weight 1,061,638,619). Every break-even moved by a factor of about 44 overnight. Nest computes the figure live on every confirmation, so the handheld was right before and after; the table below keeps both readings because the drop is the point.

| Action | Cost RF | Δ weight | Break-even at 8.55M RF/wk (until 2026-09-30 18:07 UTC) | Break-even at 193.6K RF/wk (from 18:07 UTC) |
|---|---|---|---|---|
| Genesis activation | 100,000 | +2,000,000 | 6.3 weeks | 275 weeks |
| Gen-1 tier 3→4 | 168,750 | +345,937.5 | 61 weeks | 2,676 weeks |
| Gen-1 tier 0→1 | 50,000 | +95,000 | 66 weeks | 2,887 weeks |
| Gen-1 hardwire | 100,000 | +175,000 | 71 weeks | 3,134 weeks |
| Gen-3 tier 3→4 | 1,687.5 | +2,700 | 78 weeks | 3,428 weeks |
| Gen-5 tier 0→1 | 5 | +6.375 | 98 weeks | 4,301 weeks (shown as 4,309 on the handheld, run below) |
| Gen-5 hardwire | 10 | +12 | 104 weeks | 4,570 weeks (4,579 on the handheld) |
| Gen-6 promote → 5 | 9 | +10.9 | 103 weeks | 4,528 weeks |
| Gen-6 hardwire | 1 | +1.1 | 114 weeks | 4,986 weeks (4,995 on the handheld) |

Formula: break-even weeks = cost ÷ (Δweight ÷ (totalWeight + Δweight) × weekly stream), the Steward's own maths (RF stream only; WETH shortens every figure). The small differences with the handheld are the stream's live `lastUpdate` and total weight at the block it read.

What this means, said plainly on every CONFIRM screen ("THIS IS A COLLECTOR'S SPEND, NOT A YIELD PLAY"): at today's stream no Rare Friends action pays for itself within any sensible horizon, Genesis activation included. A holder who raises a Friend buys a bigger pet, a bigger on-chain world, permanent weight and a rank; half of what they pay funds every other active Friend. Nest is built around that: its loop is care and family, not yield, and it never shows a return it cannot read from the chain at the current block.

## Where the burn is

1. **The unraised majority.** 40,703 Gen-6 Friends exist. Raising each one step (→ Gen-5) burns 4.5 RF: 183k RF if all did it. Raising them to Gen-4 burns 49.5 RF each: 2.0M RF. One holder taking one Friend from Gen-6 to Gen-1 burns 50,000 RF, thirty-three times the *daily* burn that the strongest minigame submission models for a thousand players.
2. **Sleeping Genesis.** Census on the morning of 2026-09-30: 495 Genesis activated, 529 not, of which 411 sit in the reserve and **118 are in 102 holders' wallets, inactive**. Each is a 50,000 RF burn waiting for a nudge (payback 6.3 weeks at the stream that ended on 2026-09-30, 275 weeks at the one that started): 5.9M RF in total, 7.7% of everything burned since launch. Only 2 of those 102 wallets hold the 100,000 RF activation costs today (Genesis #665 and #929), so for the other 116 the nudge is also a purchase of about 100,000 RF (~$115 at today's price). Nest's Wake button is that nudge, with the live payback number attached; the demo household includes one sleeping Genesis so the confirm can be seen without a wallet.
3. **Recurring care.** Claims cost nothing and reset hunger (the Steward flags claims under 0.5 RF as not worth gas yet). Hatching an egg costs the denomination your wallet balance selects, 1 RF for a Gen-6 (0.5 burned) up to 100,000 RF for a Gen-1: the protocol picks the highest generation the balance affords, so Save exists to park RF in a pet's wallet and hatch a cheaper pup on purpose, and Withdraw takes it back. Every pup is a new active position that can later be raised.

## Is this a game a holder wants to play?

- **Daily reason to open it:** the pet is hungry when rewards pile up (a real, growing number); feeding is one tap and lands real RF/WETH in the pet's wallet.
- **Something to want:** the next generation (visible on the on-chain art: more land), the next tier (visible in weight and weekly income), the next pup, the next rank.
- **Something to compare:** Nest Rank orders households by RF burned, indexed from the chain and computed from chain state; the index's coverage (first block, share of the total burn) is shown on screen.
- **Something kept:** every RF spent bought permanent weight in an NFT that carries its own wallet and sells with it. Nothing is spent "into the game".
- **Nothing hidden:** the Steward's break-even is on every confirmation; the burn and reward halves are on every confirmation.

## Is this economically meaningful for Rare Friends?

The protocol's design problem is that its sink is one-shot and its UI is a form. Games were meant to be the recurring sink, and the field answered with 1 RF chance tables that keep RF inside a game contract. Nest instead points players at the protocol's own sink, which is two to four orders of magnitude larger per action, and gives them the reasons a pet gives. It needs no new contract, no house, no bankroll, and the organizers keep 100% of the design authority over prices.

## Measuring what Nest causes

Nest tags every transaction it prepares (6 bytes appended to the calldata, ignored by the contracts). The indexer counts burns whose transaction carries the tag as "via Nest". On 2026-09-30 it reads **13 RF burned via Nest in 4 burn events** (12 tagged transactions of the real-wallet playthrough, [real-wallet.md](real-wallet.md)); the indexer's total matches the RF supply to 0.000%. It is the only defensible way for a contract-free front end to claim burn: anyone can recount it from the chain.

## What Nest does not claim

- It does not create yield where there is none. Generations actions are collector's spends at today's stream; Nest says so.
- It does not burn RF itself. Every burn is the protocol's.
- It does not hold keys or funds. The Steward prepares, the wallet signs.
