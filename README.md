# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/tulankganteng/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/tulankganteng/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

**Fitted comps-calibrated pre-token radar, out-of-sample LOO-CV backtest, costed farm plans.** A dashboard that ranks the protocols most likely to be worth a token launch, from a sealed DefiLlama snapshot — the multiples are learned from the snapshot itself, never hardcoded.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

Node 22.18+ (24 works), standard library only, no network, no install. In the grader the snapshot is mounted at `/input` and the output at `/output`. The program is deterministic: it builds the board twice in-process and refuses to write unless both builds agree, so two runs write the same bytes.

## What it does

- Reads the sealed snapshot (758 protocols, 2026-11-14) and ranks **198 pre-token protocols** by implied token value: all 40 on the house watchlist, plus 158 rankable pre-token protocols the watchlist leaves out (flagged `OFF-LIST` in the dashboard, with the reason stated).
- Separates what is not pre-token: 24 live-token protocols shown apart with the market's own values, and 24 token-recorded-but-unpriced protocols listed apart, so the board never pretends a token does not exist.
- Writes `board.json` (198 rows, each with implied value and a 6-step costed farm plan), `data.js`, `dashboard/` and `screenshots/` to the output, and `dossier.json` via `vendor/makefun-board.ts`.

## The model (fitted, not guessed)

The 128 live-token protocols in the snapshot are the market's own revealed price of a dollar of TVL:

1. **Families** — live protocols are deduplicated into families first (a V2, AMM, CLMM or staked variant is one token).
2. **Sector multiples** — median mcap/TVL per category, in log space, Empirical-Bayes shrunk (K=6) toward the global median (0.214x), so thin categories are pulled to the prior.
3. **Size curve** — OLS of log(mcap) on log(TVL): `log(mcap) = 6.965 + 0.522 x log(TVL)`. The slope is below 1, so bigger protocols earn a lower multiple per TVL dollar.

```
blended multiple = exp(0.35 x ln sector + 0.65 x ln size)
momentum         = 1 + 0.5 x clamp(7d change, -30%, +60%) / 100
timing           = 0.90 + 0.20 x min(age, 1095d) / 1095d  (1.00 when age unknown)
conviction       = 0.90 + 0.05 (7d known) + 0.05 (age known)
implied value    = TVL x blended x momentum x timing x conviction
```

No protocol name is ever special-cased. A protocol is pre-token when its record carries no token at all (no market cap, no CoinGecko id, no symbol), and not a wrapped, staked or bridged product of a token that trades (house rule, checked on the snapshot's own fields; `parentProtocol` is not in the snapshot, so off-watchlist rows are flagged, not hidden).

## Out-of-sample validation (shown in the dashboard)

Leave-one-out cross-validation on the 128 live families — hold each family out, refit, predict its market cap:

| Model | Median error | Within 2x | Within 3x |
|---|---|---|---|
| **Chosen blend (sector 0.35 + size 0.65)** | **x3.75** | **25.8%** | **43.8%** |
| Pure size curve | x3.40 | 32.0% | 42.2% |
| Flat global median | x5.07 | 28.1% | 35.2% |

Spearman rank correlation (predicted vs actual market cap): **0.416**. The pure size curve wins narrowly on LOO; the blend keeps a 0.35 sector weight because category pricing is a real market signal (Dexs near 0.29x TVL, Liquid Staking near 0.04x) and the dashboard shows both components per protocol. Comps are a rough guide, not a price target — the board says so on every row. The CV tests only the comps core; momentum, timing and conviction condition the launch value and are not backtested against market caps.

## Layout

```
main.ts                  entrypoint (Node 22, stdlib only)
lib/model.ts             comps fit, LOO validation, board build, farm plans
vendor/makefun-board.ts  make.fun dossier library, copied unchanged from the kit
dashboard/               index.html + app.css + app.js (static, no network)
screenshots/             1-board.png, 2-detail.png, 3-filtered.png (1280x900)
```

## Notes

- An implied value is the entry's own claim about what a launch would be worth on the protocol's current record — not a prediction that a token will be issued, or when.
- Gas figures in farm plans are per-chain estimates, stated as estimates; never pay to claim, and claim only from a protocol's own page.

---

<sub>Entered on [make.fun](https://make.fun/?ref=tulankganteng&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
