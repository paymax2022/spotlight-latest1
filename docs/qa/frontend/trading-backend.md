# Surface: Standalone Trading Backend (`mobile-app/reactnative/backend/`)

**Stack:** self-contained Go service ("Paymax Invest · Crypto"), stdlib HTTP, listens `:8080`,
its **own Postgres** (golang-migrate, `migrations/`). **Distinct from** `backend/internal/crypto`
(the ledger-integrated crypto in the main module). **Risk tier: 0** — real trading, custody,
withdrawals. Provider-adapter architecture (Market Data / Liquidity / Custody); double-entry
ledger; order state machine; idempotency on money mutations; **server-side re-pricing (never
trusts client prices/fees)**. Live adapters: Alpaca (stocks), Quidax (crypto), + mocks.

Cross-cutting money invariants apply (`../cross-cutting/money-invariants.md`). Auth is
JWT/JWKS-verified here (`internal/auth`, `jwks_test.go`) — unlike the main backend which
delegates to Supabase; test signature verification locally.

## 1. Endpoints in scope (from `internal/api/server.go`)

| Area | Endpoints | Money? |
|---|---|---|
| Ops | `GET /healthz`, `/readyz`, `/metrics` | no |
| Invest eligibility | `GET /api/v1/invest/eligibility` | no |
| Crypto market data | `GET /api/v1/crypto/assets`, `/assets/{symbol}`, `/assets/{symbol}/chart` | no |
| Crypto trade | `POST /api/v1/crypto/quote`, `/buy`, `/sell`, `/swap` | **yes** |
| Crypto custody | `GET /crypto/deposit-address`, `GET/POST /crypto/addresses`, `POST /crypto/addresses/screen`, `DELETE /crypto/addresses/{id}` | yes |
| Crypto withdraw | `GET /crypto/withdrawals/eligibility`, `POST /crypto/withdrawals/quote`, `POST /crypto/withdraw` | **yes** |
| Crypto tx | `GET /crypto/transactions`, `/transactions/{id}` | no |
| Portfolio | `GET /api/v1/portfolio`, `/positions`, `/networth` | no |
| Watchlists | `GET /watchlists`, `POST /watchlists/default/assets`, `DELETE .../{assetId}` | no |
| Alerts | `GET/POST /alerts`, `DELETE /alerts/{id}` | no |
| Stocks | `GET /stocks`, orders `GET/POST /stocks/orders`, `GET /stocks/orders/{id}`, `POST /stocks/orders/{id}/cancel` | **yes** |
| Stock offers (IPO) | `GET /stocks/offers`, `/offers/{id}`, `POST /offers/{id}/apply` | **yes** |
| Stock ticker | `GET /stocks/ticker/{symbol}` (+ `/chart`, `/news`, `/dividends`, `/corporate-actions`) | no |
| Webhooks | `POST /api/v1/crypto/webhooks/{provider}` (signature-verified) | yes |
| Admin (RBAC + maker-checker) | dashboard, users(+`{id}`), `kyc` + `POST /kyc/{id}/review`, assets(+PATCH), orders, withdrawals + `POST /withdrawals/{ref}/review`, reconciliation, providers, risk-limits(+PATCH), fees(+PATCH), feature-flags(+`PATCH /{key}`), approvals + approve/reject, audit, admins | yes |

## 2. Test matrix (existing coverage is good — cite it)

| Behavior | Existing test | Status |
|---|---|---|
| Order engine / eligibility | `internal/engine/engine_test.go`, `eligibility_test.go`, `api/eligibility_quote_test.go` | AUTOMATED |
| Reconciliation | `internal/recon/recon_test.go` | AUTOMATED |
| Webhook signature | `internal/webhook/webhook_test.go` | AUTOMATED |
| Ledger (http + shadow) | `internal/ledger/http_test.go`, `mock_test.go`, `api/ledger_shadow_test.go` | AUTOMATED |
| JWT/JWKS auth | `internal/auth/auth_test.go`, `jwks_test.go` | AUTOMATED |
| Admin (RBAC/maker-checker) | `internal/admin/service_test.go` | AUTOMATED |
| Stocks service/broker | `internal/stocks/service_test.go`, `broker_test.go` | AUTOMATED |
| Circuit breaker / rate limit | `circuitbreaker_test.go`, `ratelimit_test.go` | AUTOMATED |
| Provider adapters | `provider/alpaca/alpaca_test.go`, `provider/quidax/quidax_test.go` | AUTOMATED |
| Feature flags / networth | `api/flags_test.go`, `networth_test.go` | AUTOMATED |

## 3. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| TRADE-AUTHZ-001 | JWT signature verified locally | P0 | — | Call `/api/v1/portfolio` with a token signed by wrong key | forged JWT | 401 (JWKS mismatch) |
| TRADE-INV-001 | Buy re-prices server-side | P0 | funded, eligible | `POST /crypto/quote` then `/buy` with a **tampered** lower price/fee | altered price | Server ignores client price; fills at server price; ledger balanced |
| TRADE-INV-002 | Idempotent buy | P0 | funded | `POST /crypto/buy` twice, same Idempotency-Key | same key | One fill; one ledger journal |
| TRADE-INV-003 | Insufficient funds | P0 | low balance | Buy over balance | over | Rejected; no partial ledger |
| TRADE-FSM-001 | Order lifecycle | P0 | — | Place order → fill/cancel | — | Allowed transitions only; cancel of filled order rejected; terminal idempotent |
| TRADE-INV-004 | Sell settles correctly | P0 | holds asset | Sell units | kobo/units | Holding reduced; proceeds credited; balanced |
| TRADE-INV-005 | Swap conservation | P0 | holds asset | `POST /crypto/swap` A→B | — | Value conserved minus disclosed fee; balanced; idempotent |
| TRADE-SEC-001 | Address screening (AML) | P0 | — | `POST /crypto/addresses/screen` a flagged address | sanctioned test addr | Blocked; withdrawal to it refused |
| TRADE-INV-006 | Withdraw eligibility + quote + execute | P0 | eligible, KYC ok | eligibility → quote → `POST /crypto/withdraw` | — | Gated on eligibility+KYC; single debit; audit |
| TRADE-SEC-002 | Withdraw maker-checker | P0 | pending withdrawal | `POST /admin/withdrawals/{ref}/review` by one admin | — | Two-person approval enforced before payout |
| TRADE-WH-001 | Provider webhook signature | P0 | — | `POST /crypto/webhooks/{provider}` forged | tampered | Rejected; no state change |
| TRADE-WH-002 | Webhook replay idempotent | P0 | applied deposit event | Re-POST same event | same id | No double-credit |
| TRADE-FSM-002 | Admin approval approve/reject | P0 | pending approval | approve then re-approve | — | Idempotent; reject path grants nothing; audit |
| TRADE-INT-001 | Reconciliation clean | P0 | seeded trades | `GET /admin/reconciliation` | — | Ledger reconciles to custody/broker balances; no drift |
| TRADE-SEC-003 | Risk-limit / fee PATCH gated | P1 | admin | PATCH risk-limits/fees as non-authorized admin | — | Denied; authorized admin allowed; audit |
| TRADE-INT-002 | Circuit breaker + rate limit | P1 | provider failing | Drive provider errors past threshold | — | Breaker opens; requests shed gracefully; per-user rate limit enforced |
| TRADE-SEC-004 | Stocks IPO allocation | P1 | open offer | `POST /stocks/offers/{id}/apply` twice | — | One application per user; oversubscription handled per rules |

## 4. Automated specs to add

- Concurrency test on buy/withdraw idempotency at the DB unique-constraint (mirrors main-backend
  gap G7).
- End-to-end reconciliation assertion after a mixed buy/sell/withdraw sequence.
- Extend adapter tests to the failure/timeout paths feeding the circuit breaker.

## 5. Exit criteria

Server-side re-pricing proven (client price never trusted); buy/sell/swap/withdraw idempotent
and balanced; AML screening blocks flagged addresses; maker-checker on withdrawals; webhook
signatures verified + replay-safe; reconciliation clean; JWKS auth rejects forged tokens.
