# Crypto Trading (Quidax) — Architecture Inventory

Baseline snapshot for the Quidax crypto-trading module across the monorepo. Every path
below was read from the repo at this commit; nothing here is inferred from the UAT spec.

Date: 2026-10-21 · Branch: `fix/marketplace-voting-admin-followups` · Go toolchain: `go1.27.1 darwin/amd64`

## 1. Surfaces

| Surface | Location | Role | Crypto wiring |
| --- | --- | --- | --- |
| Go backend | `backend/` (gin, pgx/v5, module `spotlight/backend`) | source of truth for money, KYC gate, ledger, provider | two mounted groups under `/api/v1/crypto` + `/api/v1/admin/crypto` |
| Mobile (React Native / Expo) | `mobile-app/reactnative/app/crypto/**`, `src/features/crypto/**` | customer trading UX (34 screens) | live by default in `.env` (`EXPO_PUBLIC_CRYPTO_USE_MOCK=false`), deterministic mock fallback |
| Admin console (Next) | `frontend-admin/app/admin/crypto/**`, `src/services/cryptoAdminService.ts` | back office | live by default (`NEXT_PUBLIC_CRYPTO_ADMIN_USE_MOCK=false`) |
| Web BFF | `frontend-web/app/api/v1/crypto/[...path]/route.ts` | catch-all proxy → Go | HMAC helper `frontend-web/src/lib/crypto/hmac.ts`; **no crypto tests** |

## 2. Go packages (three crypto packages, all build clean)

| Package | Purpose | Non-live tests | live_db tests |
| --- | --- | --- | --- |
| `internal/crypto` | legacy surface: markets/assets, buy/sell orders, swap (atomic two-leg), addresses, deposit address, withdrawals FSM, portfolio/holdings, admin, custody on-chain balance | `invariants_test.go`, `live_journey_test.go`, `provider_quidax_test.go`, `tier_gate_test.go` | `member_permissions_live_db_test.go`, `swap_atomicity_live_db_test.go` |
| `internal/cryptosvc` | provider-driven swap pipeline: quote→confirm→webhook/reconciler settle, double-entry, fees, audit, rate limits, pgx store, admin | 199 funcs across 20 files | `adapters/backlog/fees/pgxstore/reconciler/service/settle` `_live_db_test.go` (7 files) |
| `internal/cryptoprov` (+ `.../quidax`) | provider abstraction: real Quidax HTTP adapter + deterministic mock + registry + swap FSM + webhook HMAC verify | `cryptoprov_test.go`, quidax suite | none (adapter verified via httptest) |

Ledger reuse: `cryptosvc/settle.go` posts NGN legs through `finance/ledger`
(`PostJournal`/`PostJournalGated`/`GetOrCreateStandingAccount`), standing account
`AccountCryptoClearing` ("crypto_clearing", migration `20271028000000`). ADR-002 / ADR-PR709.

## 3. Mounted routes (verified from handler source)

Member, `crypto.Register` (`internal/crypto/handler.go:244-278`), behind `mapsAuth()` +
`RequirePermission(crypto.PermView | PermTrade)`:

```
GET  /api/v1/crypto/assets                 GET  /api/v1/crypto/markets
GET  /api/v1/crypto/assets/:id/quote       GET  /api/v1/crypto/assets/:id/chart
GET  /api/v1/crypto/transactions/:id       POST /api/v1/crypto/orders/buy
POST /api/v1/crypto/orders/sell            GET  /api/v1/crypto/orders
GET  /api/v1/crypto/portfolio              GET  /api/v1/crypto/portfolio/holdings
POST /api/v1/crypto/swap/quote             POST /api/v1/crypto/swap   (Idempotency-Key)
GET  /api/v1/crypto/swap/orders            GET  /api/v1/crypto/addresses
POST /api/v1/crypto/addresses              POST /api/v1/crypto/addresses/screen
DEL  /api/v1/crypto/addresses/:id          GET  /api/v1/crypto/deposit-address
GET  /api/v1/crypto/withdrawals/eligibility POST /api/v1/crypto/withdrawals/quote
POST /api/v1/crypto/withdrawals (Idem)     GET  /api/v1/crypto/withdrawals
GET  /api/v1/crypto/withdrawals/:id        POST /api/v1/crypto/withdrawals/:id/confirm
POST /api/v1/crypto/internal/onchain-balance (custody webhook, static-secret guard)
```

Swap pipeline, `cryptosvc.RegisterRoutes` (`handler.go:107-115`), behind `PermTrade`, gated by
`FEATURE_CRYPTO_SWAPS_ENABLED`, per-user Redis rate limits on quote and confirm:

```
POST /api/v1/crypto/swaps/quote            POST /api/v1/crypto/swaps/:id/confirm
GET  /api/v1/crypto/swaps/:id              POST /api/v1/webhooks/crypto/:provider (HMAC, unauth session)
                                          #   same endpoint now routes swap AND deposit (GAP-DEP-01 s2) events
```

Admin, `crypto.Register` + `cryptosvc.RegisterAdminRoutes`, behind `PermAdmin`
(`/api/v1/admin/crypto`): orders, assets (GET/POST), withdrawals(+`/:id/decision`), swaps,
addresses(+`/:id/decision`), reconciliation; `swaps/review`, `swaps/:id/resolve`,
`reconciler` status, `fee-schedule` GET/PUT.

## 4. Provider abstraction (`internal/cryptoprov/provider.go`)

Capabilities declared: `MarketProvider`, `AccountProvider`, `WalletProvider`
(`Wallets` + `CreateDepositAddress` only — no deposit *listing* here), `SwapProvider`,
`WithdrawalProvider`, **`DepositProvider`** (`GetDeposit` authoritative re-query + `ListDeposits`,
ADR-PR798), `WebhookProvider` (swap + deposit events; `Event.Account` locates the deposit re-query).
Quidax base URL `https://openapi.quidax.io/exchange-open-api/api/v1`,
`Authorization` secret header, webhook HMAC-SHA256 verify. Registry rejects duplicate active
providers. `CryptoProvider` + TEST/LIVE creds selected by `IsProd()`; deterministic mock when
unset/creds missing (`crypto.ProvidersFromConfig`).

## 5. Feature flags / env

- `FEATURE_CRYPTO_ENABLED` (config default false) mounts the legacy surface.
- `FEATURE_CRYPTO_SWAPS_ENABLED` mounts the swap pipeline (fails closed on any missing piece).
- `CRYPTO_PROVIDER`, `QUIDAX_TEST_API_KEY`/`QUIDAX_LIVE_API_KEY`, `QUIDAX_*_BASE_URL`,
  `QUIDAX_WEBHOOK_SECRET`, `CRYPTO_LOCK_POOL_CONNS`, `CRYPTO_RECONCILE_SECONDS`,
  `CRYPTO_QUOTE_RATE_PER_MIN`/`CRYPTO_CONFIRM_RATE_PER_MIN` (config.go ~895-1053).
- Mobile `EXPO_PUBLIC_CRYPTO_USE_MOCK`; Admin `NEXT_PUBLIC_CRYPTO_ADMIN_USE_MOCK`.

## 6. Migrations present (additive; version-uniqueness enforced by CI)

`20260815001600_crypto`, `20260920000000_crypto_schema`, `20271027000000` (crypto_webhook_events,
crypto_swaps), `20271031000000` (crypto_accounts + swap idempotency), `20271038000000`
(crypto_fee_schedules), `20271042000000` (member permissions), `20260919000500`
(crypto_onchain_balances), `20271028000000/100` (crypto_clearing ledger type + swap ledger inputs),
`20261029000100_trading_wallet`. All applied to the local Supabase dev DB (verified: `ledger_accounts`,
`crypto_swaps`, `crypto_fee_schedules`, `auth.users` present).

## 7. Balance-plane asymmetry — RESOLVED by ADR-PR798 (Option A, deposit build now shipped)

- Customer **crypto-unit holdings** live in the legacy `crypto` plane (`crypto_holdings`, integer
  asset minor units, `Sell` guarded by `units >= 0` CHECK) — **not** as per-asset crypto accounts in
  `finance/ledger` (its `ledger_accounts` enforces `char_length(currency)=3`, so USDT/USDC cannot fit,
  and `ledger_entries.amount_kobo` has no per-asset scale).
- `cryptosvc` settles **NGN kobo** legs only in the ledger (`SideSwap`: "crypto→crypto: no NGN leg,
  nothing to post").
- **Decision (ADR-PR798):** money-IN does NOT fork the balance plane or DDL the fiat ledger. Inbound
  deposits credit the existing `crypto_holdings` projection, backed by an append-only
  `crypto_deposits` journal (`UNIQUE(provider_op_id)`) written in the same transaction — the
  `crypto.Repository.RecordFill` once-only idiom. `internal/crypto/deposit` is that engine;
  `cryptoprov.DepositProvider` supplies the authoritative re-query and `cryptosvc.Ingest` routes
  `deposit.*` / `transaction.*` deliveries to it through a narrow `DepositSettler` seam bridged in
  `app`. Outstanding (GAP-DEP-01): a deposit reconciler polling `ListDeposits`, and the admin/mobile
  surface (slice 3).

