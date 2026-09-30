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

## Break-even at today's stream (RF stream only; WETH shortens every figure)

| Action | Cost RF | Δ weight | RF/week gained | Break-even |
|---|---|---|---|---|
| Genesis activation | 100,000 | +2,000,000 | 15,997 | **6.3 weeks** |
| Gen-1 tier 0→1 | 50,000 | +95,000 | 760 | 66 weeks |
| Gen-1 hardwire | 100,000 | +175,000 | 1,400 | 71 weeks |
| Gen-3 tier 3→4 | 1,687.5 | +2,700 | 21.6 | 78 weeks |
| Gen-6 promote → 5 | 9 | +10.9 | 0.087 | 103 weeks |
| Gen-6 tier 0→1 | 0.5 | +0.59 | 0.005 | 106 weeks |

Formula: break-even weeks = cost ÷ (Δweight ÷ totalWeight × weekly stream). Weights are roughly proportional to cost by design, so every Generations action clusters around 65–106 weeks; only Genesis activation is a yield play. Nest shows this number before every payment. That honesty is the point: a Generations holder who raises a Friend is buying a bigger pet, a bigger on-chain world, permanent weight, and a rank, not a yield. Half of what they pay funds everyone else's pet, including their own.

## Where the burn is

1. **The unraised majority.** 40,703 Gen-6 Friends exist. Raising each one step (→ Gen-5) burns 4.5 RF: 183k RF if all did it. Raising them to Gen-4 burns 49.5 RF each: 2.0M RF. One holder taking one Friend from Gen-6 to Gen-1 burns 50,000 RF, thirty-three times the *daily* burn that the strongest minigame submission models for a thousand players.
2. **Sleeping Genesis.** Census on 2026-09-30: 495 Genesis activated, 529 not, of which 411 sit in the reserve and **118 are in 102 holders' wallets, inactive**. Each is a 50,000 RF burn with a 6-week payback waiting for a nudge: 5.9M RF in total, 7.7% of everything burned since launch. Nest's Wake button is that nudge, with the number attached.
3. **Recurring care.** Claims cost nothing and reset hunger. Hatching an egg costs 1 RF (0.5 burned) and adds a pup: the cheapest recurring action, and every pup is a new active position that can later be raised.

## Is this a game a holder wants to play?

- **Daily reason to open it:** the pet is hungry when rewards pile up (a real, growing number); feeding is one tap and lands real RF/WETH in the pet's wallet.
- **Something to want:** the next generation (visible on the on-chain art: more land), the next tier (visible in weight and weekly income), the next pup, the next rank.
- **Something to compare:** Nest Rank orders households by real RF burned, indexed from the chain. Nobody can fake it.
- **Something kept:** every RF spent bought permanent weight in an NFT that carries its own wallet and sells with it. Nothing is spent "into the game".
- **Nothing hidden:** the Steward's break-even is on every confirmation; the burn and reward halves are on every confirmation.

## Is this economically meaningful for Rare Friends?

The protocol's design problem is that its sink is one-shot and its UI is a form. Games were meant to be the recurring sink, and the field answered with 1 RF chance tables that keep RF inside a game contract. Nest instead points players at the protocol's own sink, which is two to four orders of magnitude larger per action, and gives them the reasons a pet gives. It needs no new contract, no house, no bankroll, and the organizers keep 100% of the design authority over prices.

## What Nest does not claim

- It does not create yield where there is none. Generations actions are collector's spends at today's stream; Nest says so.
- It does not burn RF itself. Every burn is the protocol's.
- It does not hold keys or funds. The Steward prepares, the wallet signs.
