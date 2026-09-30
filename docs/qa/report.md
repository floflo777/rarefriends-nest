# Nest QA report, 2026-09-30

Two hats: a Rare Friends holder opening the app for the first time, and a hostile Vibeathon judge. Build `npm run build -w @nest/web`, served by `vite preview` on 127.0.0.1:4173, driven with Chromium (`docs/qa/tour.mjs`, `docs/qa/tour2.mjs`; every LCD transcript in `transcripts.json` / `transcripts2.json`, 63 screenshots in `shots/`). Viewports 1280×800 and 360×740, touch, keyboard only, `prefers-reduced-motion`. CLI run sequentially against the public RPC. No source file modified, nothing sent on chain. Unit tests: core 76 passed (6 live skipped), web 25, indexer 19.

## 1. Bugs

| # | Sev | What | Repro | Shot |
|---|---|---|---|---|
| B1 | Medium | CONFIRM header truncates the label at 19 chars: the target tier/generation and the `(tier resets to 0)` warning never reach the screen. A holder confirming a promote after an upgrade is not told the upgrade is lost. | `/demo` → HOUSEHOLD → QUOK → CARE → Train (0.5 RF) → Raise: header `RAISE #612044 TO GE`; also `TRAIN #1969 TO TIER`, `HATCH EGG #700001 A` | `shots/demo2-pup-confirm-1.png` |
| B2 | Medium | CARE list truncation produces wrong information: `HATCH EGG #700 100K RF` (egg is #700001), `SAVE 150,000 RF I FREE`, `TRAIN #1969 TO 113K RF`. | `/demo` → CARE | `shots/kb-focus-ring.png` |
| B3 | Medium | Rationale cut with `..`: `STREAM: THIS IS A..`. The "collector's spend, not a yield play" sentence the docs call the honesty line never fits. Same for Feed (`...OWN WALLE..`). | any paid CONFIRM | `shots/demo2-pup-confirm-1.png` |
| B4 | Medium (design) | CONFIRM defaults to YES. From PET, three presses of the same button (● ● ●) reach the signing flow of the first care item; in wallet mode one more ● signs. Fine in demo, a footgun for 112,500 RF. | `/demo` → ● ● ● → toast | transcripts `feed-1969-confirm` |
| B5 | Low | Nonexistent Friend reported as an egg: `/pet/gen/99999999` → `EGG / NOT HATCHED YET / HARDWIRE IT FIRST`, plus a "Pet card" link. The chain returns generation 0 for any unminted id; CLI says the same. No upper bound check. | `/pet/gen/99999999` | `shots/d-v_pet_gen_99999999-pet.png` |
| B6 | Low | Web gives Genesis a Generations family and name (#597 → `ILASHA`, `MASK`, mood RESTLESS); CLI prints `family —`, no name, mood `content`. UI and CLI disagree on the same token. | `/pet/genesis/597` vs `nest state genesis 597` | `shots/d-v_pet_genesis_597-pet.png` |
| B7 | Low | STATS `SHARE 1.9E-5%` (scientific notation on an LCD); `UNCL 36400 RF` shows false precision (36,384.65 on chain). | `/pet/gen/343695` STATS | `shots/d-v_pet_gen_343695-stats.png` |
| B8 | Low | RANK in visitor mode says `YOU #11 263K RF`: "YOU" is the owner of the viewed Friend, not the visitor. | `/pet/gen/1969` → RANK | `shots/d-v1969-rank.png` |
| B9 | Low | Demo #343695 is `FLAHIEL / HOVERER`; the real #343695 is `LOPLOEW / ASYMMETRY`. Same id, two different pets between `/demo` and `/pet/gen/343695`. Every demo Friend except #1969 uses a generic placeholder silhouette. | compare both routes | `shots/demo-pet-343695.png`, `shots/d-v_pet_gen_343695-pet.png` |
| B10 | Low | Demo: hunger never returns after Feed (mock accrues no rewards); still 0% 35 s after the slow tick. Demo LEDGER says `GENESIS OFF 118`, live says `529`. | `/demo` Feed, wait | transcripts2 `1969-pet-fed-35s` |
| B11 | Low | Two moods advertised in design.md (`proud`, `thrifty`) are unreachable: `apps/web/src/model/pet.ts:39` calls `moodState(vitals, personality, now)` without `recentEvents` / `previousSavings`. | code | — |
| B12 | Low | Steward ranks `Feed #612044: 0.01 RF` first for a Gen-6 pup; gas exceeds the reward; no threshold, no warning. | `/demo` → QUOK → CARE | `shots/demo2-pup-confirm-0.png` |
| B13 | Low (env) | Two RPC calls failed with CORS `Access-Control-Allow-Origin contains multiple values '*,*'` during the run; the app recovered on retry. On a bad RPC day a judge sees `NO SIGNAL`. | tour console log | transcripts `_consoleErrors` |

Worked: phone layout (no horizontal overflow, LCD scale 3, 60 px buttons), touch, keyboard (arrows/Enter/Space, Enter on a focused button fires once, visible focus ring, form Enter navigates), reduced motion (1 frame vs 4 frames in 3 s), card PNG download (`nest-gen-1969.png`), SPA `404.html` fallback, `SIMULATED:` prefix on every demo toast, `EGG` state on the real temporary Friend #343693, GitHub Pages URL answers 200, household list scrolls past 7 rows.

## 2. Cross-check: UI vs CLI/RPC vs docs

| Number | UI | CLI / formula | Docs | OK |
|---|---|---|---|---|
| #1969 weight / share / RF-week | 416,250 / 0.0389% / 3332 | 416,250 / 0.038948% / 3331.5 | — | yes |
| #1969 unclaimed | 36400 RF, 0.0228 WETH | 36,384.65 / 0.02283 | — | yes (rounding, B7) |
| Genesis #597 | 2,000,000 / 0.1871% / 16009 / 162K | 2,000,000 / 0.187137% / 16009 / 161,754 | — | yes |
| Train #1969 T2→3 | 112,500 / burn 56,250 / +225,000 / 62.6 wk | formula 62.5 | SUBMISSION "66–114 wk" | range wrong |
| Raise #343695 →G3 | 900 / 450 / +1,251 / 89.9 wk | CLI plan 89.9 | — | yes |
| Hatch Gen-1; Wake Genesis | 100,000 / 50,000 / +175,000 / 71.5 wk; 100,000 / +2,000,000 / 6.3 wk | — | 71 wk; 6.3 wk | yes |
| Pup Train / Raise | 0.5 / +0.5875 / 106.4 wk; 9 / +10.9 / 103.2 wk | — | 106; 103 | yes |
| Demo after actions | burned 84,500 → 185K, ledger 76.26M → 76.36M, weight 416,250 → 641,250 | recomputed by hand | — | coherent |
| LEDGER burned / stream / weight | 76.27M / 8.55M / 1.07B | census 76,267,677 / 8,553,790 / 1,068,730,245 | 76.26M | yes |
| Full break-even range (35 Generations actions, today's stream) | app shows 62.6 | 61.0 (G1 T3→4) to 113.7 (hardwire G6) | economics "65–106", SUBMISSION "66–114" | three ranges |
| Rank coverage | top-6 + YOU | snapshot.meta: from block 65,356,920, `complete:false`, `status:"running"`, indexed 42.65M of 76.27M burned (gap 44%) | design: "indexed from the chain… nothing can be faked" | overstated |
| Burn attribution by function | — | 24,615 of 47,020 events (52%) selector `unknown` (427k RF) | SUBMISSION: "attributed to the sender and function" | partly |

## 3. Claims the running software does not deliver

| Claim | Where | Reality |
|---|---|---|
| "Hatching an egg is `hardwire(6)` for 1 RF" | README, design.md table | The balance selects the generation; demo hatches Gen-1 for 100,000 RF by default, `plan 0x3d35…` hatches Gen-4 for 100 RF. Save exists precisely because of this. |
| "Colour mode shows the frames with the original palette and the on-chain `tokenURI` scene unaltered" | design.md | No colour mode, no `tokenURI` read anywhere in `apps/web`. Frames are 1-bit 16×16 at 2× on a green LCD. |
| Moods `proud`, `thrifty` | design.md | Unreachable (B11). |
| "Savings … Withdraw (owner) … ERC-6551 `execute`" | design.md table | No withdraw action. Save parks RF in the TBA with the text "still yours, withdrawable" and offers no way out. |
| "Nest Rank … nothing can be faked" | design.md | Partial index (44% of burns unattributed), early adopters undercounted; #1 wallet holds 51% of indexed burn (21.65M). |
| Break-even "66–114 weeks" | SUBMISSION | 61–114 (app shows 62.6). |
| "(GitHub Pages URL)", "Telegram: (fill in)", "Real-wallet playthrough: (fill in)" | SUBMISSION | Placeholders. The Pages URL exists and answers 200. Zero real transactions are documented. |
| "Every care action is a real Rare Friends protocol action" | README | Save is a plain ERC-20 transfer. |

## 4. Hostile judge

| Criterion | Strongest attack | Score |
|---|---|---|
| Character Spotlight | "The character is a 16×16 blob. In the demo, the screen most judges will see, #1969 is a hand-typed frame and every other Friend is a generic placeholder with a made-up family. The NFT's actual scene (land, palette, tokenURI) never appears; the sprite does not change from Gen-6 to Gen-1, so 'it grows' is a sentence, not a pixel. Names and personality are authored tables, not the NFT." Defence: visitor mode renders the real 64 registry frames of any Friend, animated and mood-driven; identity, wallet and owner are real. | 6/10 |
| Token Activity | "Nest has burned 0 RF. No transaction has ever been sent through it (playthrough: fill in). It is a front end over functions that already burn; the Burn Ledger counts burns Nest did not cause and cannot tell which burns came through Nest, so 'most successful at burning' is unmeasurable by construction. Half the events it indexes have an unknown selector and 44% of all burned RF is outside the index." Defence: nothing simulated is reported as real, dry-run proofs exist, split and break-even shown before every payment. | 4/10 |
| Economy Potential | "Nest adds no economy. It re-skins a sink whose break-even is 61–114 weeks and prints that number on the confirm screen: the app argues against spending. The only recurring actions are a free claim and hatching, and hatching needs a new egg. Nothing makes a holder spend more than the website form does: no goal, no streak, no social comparison beyond a wallet list dominated by one whale." Defence: the 5.9M RF of sleeping Genesis (6.3 wk payback) and the 40,703 unraised Gen-6 are correctly identified and quantified; Steward + CLI make an agent-driven sink plausible. | 5/10 |

Judge without a Friend can see: any Friend read-only with live numbers, the full demo (Feed/Train/Raise/Hatch/Wake/Save, all labelled), Ledger, Rank, Card, CLI JSON, `docs/dry-run.md`. Cannot see: the wallet run screens (SIMULATING → READY/GAS → SIGN → PENDING → DONE, WOULD REVERT), the ownership gate, tx links, a real household with a real egg, button sound (opt-in). The demo bypasses the dry-run, so the one flow that distinguishes Nest from a form is invisible.

## 5. Player pass

Would I come back tomorrow? With a Gen-1 or Genesis, maybe: the hunger bar is real RF and Feed is one tap. With a Gen-6 pup (65% of Friends) no: hunger hits 100% in a week over 0.0088 RF, feeding costs more gas than it claims, and nothing else changes day to day but one speech line per UTC day. Nothing is lost by neglect, so nothing pulls.

First 60 seconds: landing is a paragraph lifted from design.md with no picture of a pet and "Connect wallet" as the primary button with no chain hint. On the device: `UNCL`, `G1 T2`, `@ CARE`, the `{ }` glyphs, `SHARE 1.9E-5%`, truncated labels, a confirm header cut mid-word, "weight" undefined anywhere on screen, `YOU #11` when I am a visitor.

Screen that made me want to spend: `WAKE #77` (6.3 wk, +2,000,000, "cheap for what it adds"), the only positively framed confirm, and the household egg row (`EGG #700001 G1 100K RF`). Spreadsheet screens: STATS (eight number rows), LEDGER, and CONFIRM itself (COST/BURN/REW/+WEIGHT/BREAK-EVEN then a cut sentence).

Missing for a virtual pet: visible growth (same sprite at every generation and tier), a reaction when cared for (Feed → a text toast, no eating frame), an evolution moment on Raise, a care history ("fed 3 days ago"), any need besides hunger (strength and territory never move without paying), any consequence of neglect, a comparison between pets rather than wallets, sound on by default.

## 6. Ten most valuable fixes, smallest change for largest effect first

1. CONFIRM: two-line label or a second header row with the target (`→ TIER 3`, `→ GEN 5 · TIER RESETS`); wrap the rationale to three full lines instead of cutting with `..` (B1, B3).
2. SUBMISSION: fill the Pages URL (it works), Telegram, playthrough status; change "66–114" to "61–114"; delete the `hardwire(6) for 1 RF` sentence from README/design and say "the generation your balance affords; Save lets you choose".
3. Demo: put `SIM` in the header of every screen (PET, STATS, HOUSEHOLD, RANK, LEDGER currently have none); let the mock accrue rewards with time so hunger comes back (B10).
4. RANK/LEDGER: print coverage on the screen (`SINCE BLK 65.36M · 56% OF BURN`) and rewrite "nothing can be faked" in design.md to "indexed from block X, partial"; rebuild the snapshot to completion before submitting.
5. Feed: hide or label claims under a threshold (`NOT WORTH GAS YET`) and stop ranking them first (B12).
6. Paid CONFIRM defaults to NO (free Feed keeps YES) (B4).
7. Growth you can see: scale the sprite by generation (2× Gen-6 … 3× Gen-1) or add a tier badge; one render change turns "it grows" into a pixel.
8. Enable `proud` (feed `recentEvents` from the burn records already indexed per owner) and `thrifty` (previous savings in localStorage), or drop them from design.md (B11).
9. Demo fidelity: load the real registry frames and families for #1969 and #343695 (they are real ids) or stamp `PLACEHOLDER ART` on the LCD (B9); Genesis without a family in both UI and CLI (B6).
10. Landing: embed the live LCD of a real Friend above the text with "no wallet needed"; fix number formats (`<0.001%`, `36.4K`); bound unknown ids by the max hardwired id from the snapshot (B5, B7).
