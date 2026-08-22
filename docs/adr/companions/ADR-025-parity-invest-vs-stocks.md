# ADR-025 companion — Parity diff: `internal/invest` vs standalone `internal/stocks`

**Date:** 2026-08-04
**Status:** Informational (feeds ADR-025 P3)
**Compares:** `backend/internal/invest` (main module, "Paymax Invest") vs
`mobile-app/reactnative/backend/internal/stocks` (+ its `internal/api/stocks_handlers.go`,
`internal/api/server.go`) in `paymax/crypto-backend`.

## Verdict

**`internal/invest` strictly supersedes the standalone stocks module — feature-wise
AND on money integrity. Recommendation: DROP the standalone stocks island; do not fold
its engine. Harvest only two small assets (NGX seed data; confirm a pre-trade estimate
endpoint), then retire it with the rest of `crypto-backend` (ADR-025 P6).**

The standalone is a **mock-first prototype**: buy pre-checks run against *"illustrative
investable balances … fixed investable balance"* (`internal/stocks/service.go:29,144`) —
there is **no ledger, no persistence of record, no compliance gate**. `internal/invest`
is the production home.

## Money model — the decisive difference

| | `internal/invest` | standalone `internal/stocks` |
|---|---|---|
| Cash model | **Double-entry** `InvestLedger` — "balanced pair of immutable entries; balances always projected via SUM," atomic `Post(tx)` (`invest/ledger.go`) | **Fixed illustrative balance**, in-memory pre-check (`service.go:29`) — not real money |
| Order persistence | Postgres `invest_orders` with `estimated_price_kobo`, `executed_price_kobo`, `fees_kobo`, `total_amount_kobo`, `status`, `idempotency_key`, provider (`repository.go`) | in-memory / own pgstore, mock lifecycle |
| Settlement | `/admin/…/settlement/{pending,run}`, reconciliation, broker webhook | none (mock fill) |
| Idempotency | order `idempotency_key` + ledger dedup | key threaded but no ledger backstop |

## Feature parity matrix

| Capability | `internal/invest` | standalone `stocks` | Verdict |
|---|---|---|---|
| Asset catalog / detail | ✅ `/search`, `/:symbol`, admin assets CRUD | ✅ `Assets`, `Asset` | invest ⊇ |
| Chart / news / dividends / corporate-actions | ✅ `/:symbol/{chart,news,dividends,corporate-actions}` + admin ingestion | ✅ read-only, mock | invest ⊇ |
| Quotes / market status | ✅ `MarketDataAdapter`, `/market-status` | ✅ mock quotes | invest ⊇ |
| Buy / sell / cancel orders | ✅ `/orders/{buy,sell,:id,:id/cancel}`, ledger-posted | ✅ `PlaceOrder`/`CancelOrder`, mock | invest ⊇ (ledgered) |
| Positions / portfolio | ✅ `/overview` (PortfolioView) | ✅ `Positions`, `Portfolio`, networth | invest ⊇ |
| Watchlists | ✅ full CRUD + items | ✅ default-list only | invest ⊇ |
| Price alerts | ✅ `/alerts` CRUD | ❌ | **invest only** |
| Public offers (IPOs) | ✅ `/public-offers…/apply` | ✅ `PublicOffers`, `ApplyToOffer` | invest ⊇ |
| Rights issues | ✅ `/rights-issues…/accept` | ❌ | **invest only** |
| Wallet (deposit/withdraw/txns) | ✅ ledger-backed | ❌ (fixed balance) | **invest only** |
| Onboarding / eligibility / suitability / agreements / PIN | ✅ full compliance flow | ❌ | **invest only** |
| Fees schedule (get/set) | ✅ `/admin/…/fees` | partial (fee lines on estimate) | invest ⊇ |
| Reconciliation / provider health / audit | ✅ | ❌ | **invest only** |
| Broker/venue seam | ✅ `BrokerAdapter` + `/webhooks/broker` | ✅ `Broker.Place` (cleaner doc-comment) | parity; keep invest's |
| Pre-trade estimate (fees/total/settlement) | ⚠️ fields exist (`EstimatedPriceKobo`, fees, total; model.go:434) but **NO dedicated preview endpoint** — computed inline in buy/sell (`routes.go` confirms only `/orders/{buy,sell,…}`) | ✅ `OrderEstimate` + estimate call | **the one real additive gap** |
| Observability (metrics/tracing) | ❌ (module) | ✅ (service-wide) | cross-cutting → ADR-025 P4, not stocks-specific |

Nothing in the "standalone stocks" column is a capability `internal/invest` lacks,
except the two flagged below.

## Harvest list (the only things worth taking before retiring)

1. **NGX seed / mock data** — `internal/stocks/mockdata.go` has 26 curated instruments
   with candles/news/dividends: real NGX tickers (`DANGCEM, MTNN, GTCO, ZENITHBANK,
   ARADEL, NESTLE`) + US (`AAPL, TSLA, VOO`). **Fold into `internal/invest`'s asset
   catalog seed / dev fixtures** (it's good sample data), then drop the code.
2. **Pre-trade estimate endpoint** — the standalone exposes an `OrderEstimate`
   (`side, qty, estPrice, gross, fees[], total`). `internal/invest` computes these fields
   on buy/sell but — **confirmed via `routes.go`** — exposes **no dedicated preview
   endpoint** (only `/orders/{buy,sell,…}`). **Add `POST /orders/estimate`** (thin,
   read-only, no money move) so the app can show fees/total/settlement before the user
   confirms. This is the one real, additive gap from the whole standalone stocks island.

Not worth harvesting: the `Broker.Place` seam (invest's `BrokerAdapter` + webhook is
richer), the `StockError` taxonomy (invest has its own error handling), the mock
lifecycle (superseded by real settlement). Observability is a platform-wide concern
handled in ADR-025 P4, not part of the stocks fold.

## Recommended action (ADR-025 P3 for stocks)

1. Migrate `mockdata.go` instruments into an additive `invest_assets` seed (or dev
   fixtures) under the additive-migration convention.
2. Parity-check the estimate endpoint; add `POST /orders/estimate` to `internal/invest`
   if absent (read-only, ledger-free).
3. Repoint any mobile stocks UI still calling `paymax/crypto-backend` `/api/v1/stocks/*`
   at `internal/invest` `/api/v1/invest/*` (client cutover — ADR-025 P5).
4. Delete `mobile-app/reactnative/backend/internal/stocks` + its handlers with the
   `crypto-backend` decommission (ADR-025 P6). **No engine fold required.**

## One-line summary

There is no "fold stocks in" work — `internal/invest` already *is* the ledgered,
compliance-gated stocks brokerage. Take the NGX sample data, confirm one estimate
endpoint, cut the clients over, and retire the mock island.
