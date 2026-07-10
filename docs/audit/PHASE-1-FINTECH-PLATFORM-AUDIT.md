# Phase 1 — Full Repository Audit: Quidax × Alpaca Fintech Platform

**Status:** Read-only architectural analysis. **No code was modified.**
**Date:** 2026-07-10
**Scope:** The Paymax/Spotlight monorepo at repository root, focused on the trading, wallet, portfolio, onboarding and money surfaces.
**Method:** Four parallel read-only audits (crypto-backend trading module, spotlight finance/money core, client surfaces, infra/security/testing), every claim cited to `file:symbol`.

---

## 0. Executive Summary

The repository is **not** a single trading service — it is a super-app monorepo containing **two independent Go backends** plus **two separate crypto implementations**, with **three overlapping trading UIs** on mobile. The good news: the foundational money engineering is genuinely strong. The work ahead is **consolidation and provider abstraction**, not greenfield construction.

**The two backends:**

| | `spotlight/backend` (`backend/`) | `paymax/crypto-backend` (`mobile-app/reactnative/backend/`) |
|---|---|---|
| Module | `spotlight/backend`, ~289K LOC | `paymax/crypto-backend`, ~11K LOC |
| Role | Super-app money core: ledger, wallet, KYC, FX, VA, transfers, settlement, **and its own `internal/crypto`** | Standalone trading engine: crypto + stocks + portfolio + invest eligibility + admin plane |
| Money model | **Genuine double-entry**, NGN kobo, TOCTOU-safe, idempotent | Single-row ledger, not truly balanced; **hardcoded `demo-user`** |
| Providers | Clean ports-and-adapters (Paystack/Maplerad/Monnify/Eversend + KYC ports) | `MarketData`/`Liquidity`/`Custody` interfaces (mock-first); **no execution/broker seam** |
| Data | Supabase Postgres, 291 additive migrations | **Its own Postgres**, golang-migrate, 5 migrations |
| Observability | **None** (no metrics/otel/structured logs) | **Full** (Prometheus text, tracing, health, rate-limit, circuit breaker) |
| Deploy/CI | Mature multi-lane CI; cPanel/Passenger prod | **No CI, no deploy** |

**The single most important architectural fact:** crypto exists **twice** — once inside the money core (`backend/internal/crypto`, ledger-integrated, AML-gated, custody reconciliation) and once as the standalone trading module (`mobile-app/reactnative/backend`, mock-first). Stocks exist as a **third, mock-only island**. The Quidax×Alpaca vision cannot be delivered until these are reconciled behind one provider-agnostic surface.

**Top 5 things that are already excellent** (reuse, do not rebuild):
1. **Double-entry ledger** in `backend/internal/finance/ledger` — derived balances, immutable entries, reversal-only corrections, TOCTOU-safe debits with advisory locks.
2. **Provider ports** in `backend/internal/provider` — capability-scoped interfaces with failover registries; the maplerad *domain* package structurally forbids importing the maplerad *adapter*.
3. **Tiered KYC/AML engine** in `backend/internal/finance/kycverify` — multi-provider (Dojah/Smile/Youverify), CBN tier check-sets, AML/PEP at Tier 3, human-review gating.
4. **Institutional admin plane** in the crypto-backend — RBAC matrix + four-eyes maker-checker + append-only audit.
5. **Fail-closed compliance gate** in the crypto-backend — `engine.EvaluateEligibility`, single source of truth, enforced pre-trade.

**Top 5 risks / blockers** (detailed in Part D):
1. **Leaked secrets in git history** — ~50 tracked `.env_*.local` snapshots under `.history/` and `.agentwork/*/`. Requires purge + credential rotation. **(Highest.)**
2. **Duplicate crypto subsystems** and **duplicate Postgres persistence** inside the trading module (`pgstore.Store` vs the unwired `store.PgRepository`).
3. **Identity doesn't reach persistence** in the trading module (`demo-user` hardcoded; per-user repo unwired) → no real multi-tenancy.
4. **No execution/broker provider seam** → cannot plug in Alpaca or a real crypto liquidity venue without design work; stocks are entirely mock.
5. **No observability, no IaC/K8s, no secrets manager, no MFA** → not yet operable at "millions of users."

---

## Part A — Architecture Report

### A.1 Frontend / Client structure

**Mobile (`mobile-app/reactnative`)** — Expo Router super-app, ~60 route groups under `app/`, feature code under `src/features/<name>/`. Shared axios client `src/api/client.ts` keyed on `EXPO_PUBLIC_API_BASE_URL` (default `:3000` Next proxy → Go `:8080`). Uniform `EXPO_PUBLIC_<FEATURE>_USE_MOCK` (default `'true'`) mock pattern.

- **Three overlapping trading surfaces:**
  - `app/crypto/*` + `src/features/crypto/` → `/api/v1/crypto/*` (hub, portfolio, assets, buy/sell/swap, deposit/withdraw, addresses, alerts, watchlist).
  - `app/stocks/*` + `src/features/stocks/` → `/api/v1/stocks/*`, reuses `/api/v1/invest/portfolio`.
  - `app/invest/*` + `src/features/invest/` → `/api/v1/invest/*` (a **second** equities hub with its own `invest.client.ts`) plus `invest-onboarding`, `invest-settings`, `invest-ai` sub-features.
- **Money core UI is separate from trading:** `app/(tabs)/wallet.tsx` is the **fiat bills wallet only** (Supabase-backed, not the trading backend); `app/(tabs)/home.tsx` is the bills/services dashboard with no trading data.
- **Design system:** static single **light** theme (`src/constants/colors.ts` et al.). **No dark mode**, **no global i18n** (only a local toggle in `src/features/triage/`).

**Admin (`frontend-admin`)** — Next.js console. Services in `src/services/*AdminService.ts` → `:8080/api/v1`, Bearer from `localStorage`. Mirrors the split: `app/admin/crypto/*` (RBAC `crypto.admin`) and `app/admin/invest/*` (RBAC `invest.manage`) are **two separate control planes**; plus `app/admin/finance/*`, `app/admin/fx/*`, RBAC/audit surfaces.

**Web (`frontend-web`)** — marketing/contest site + **API gateway**. For trading it is a pure proxy: `app/api/v1/{crypto,stocks,invest}/[...path]/route.ts` → `GO_BACKEND_URL` (`src/lib/go-backend.ts`). The crypto proxy explicitly notes the main backend has **no** `/api/v1/crypto` group — a wiring ambiguity (both Go services default to `:8080`).

### A.2 Backend structure

**`spotlight/backend`** — Gin, pgxpool, module `spotlight/backend`.
- **Money core:** `internal/finance/{ledger,wallet,fx,kyc,kycverify,va,transfers,settlement,tiers,referrals,disputes,ratings,maplerad}` + `internal/crypto`.
- **Providers:** `internal/provider/{interfaces.go,ports.go}` + adapters `paystack`, `monnify`, `maplerad`, `eversend`, `disbursement/registry.go`.
- **Cross-cutting:** `internal/config/{config.go,validate.go}` (~200 env vars, fail-fast prod validation), `internal/middleware/authorization.go` (RBAC), `internal/platform/{db,redis}`.
- **Routing:** per-domain `*_routes.go` under `internal/app`.

**`paymax/crypto-backend`** — stdlib `net/http` (Go 1.22 method routing), single dep `pgx/v5`.
- `cmd/server/main.go` (boot, storage swap, graceful shutdown), `internal/api/{server.go,handlers.go,admin_handlers.go,stocks_handlers.go}`.
- Domain `internal/domain/types.go`; engines `internal/engine` (pricing/eligibility) + `internal/stocks`.
- Persistence: **three** impls of `internal/store/repository.go` — `store.Store` (in-memory), `pgstore.Store` (wired, `wallet_balances`), `store.PgRepository` (mature, ledger-derived, **unwired**).
- Provider seam `internal/adapter/adapter.go` + `internal/httpadapter/httpadapter.go`; resilience `internal/{circuitbreaker,ratelimit,metrics,tracing,recon,webhook}`; auth `internal/auth/{auth.go,jwks.go,middleware_verifier.go}`; admin `internal/admin/{rbac.go,service.go,types.go}`.

### A.3 Services / modules / bounded contexts

| Bounded context | Location | Maturity |
|---|---|---|
| Ledger (double-entry) | `backend/internal/finance/ledger` | **Production** |
| Wallet (NGN, ledger projection) | `backend/internal/finance/wallet` | **Production** |
| FX (quote→convert) | `backend/internal/finance/fx` | Production (NGN↔USD/GBP/EUR mirror) |
| KYC/AML | `backend/internal/finance/{kyc,kycverify}` | **Production** (multi-provider) |
| Virtual accounts | `backend/internal/finance/va` | Production (NGN) |
| Transfers (wallet/bank) | `backend/internal/finance/transfers` | Production (guarded FSM, PIN) |
| Settlement/split | `backend/internal/finance/settlement` | Production |
| Crypto (ledger-integrated) | `backend/internal/crypto` | Production-shaped, mock providers |
| Crypto+Stocks trading | `mobile-app/reactnative/backend` | **Mock-first, single-user** |
| Stocks/Invest | `mobile-app/reactnative/backend/internal/stocks` | **Mock island** |

### A.4 API routes (representative)

- **Trading module** (`internal/api/server.go`): `GET/POST /api/v1/crypto/{assets,quote,buy,sell,swap,deposit-address,transactions,watchlist,alerts,addresses,withdraw,withdrawals/*,webhooks/{provider}}`; `/api/v1/invest/eligibility`; `/api/v1/portfolio`; `/api/v1/stocks/{,orders,offers,{symbol}/chart|news|dividends|corporate-actions}`; `/api/v1/admin/*` (24 routes); `/healthz`, `/readyz`, `/metrics`.
- **Money core** (`backend/internal/app/*_routes.go`): `/api/finance/{wallet,kyc,fx,va,transfers,...}`, `/api/crypto/*`, admin under `/api/.../admin/*`, all `RequirePermission`-gated.

### A.5 Database models, migrations, queues, cron, cache, events

- **Money model:** integer minor units everywhere (NGN kobo; crypto base units). Ledger balances **derived** from immutable `ledger_entries` (`UNIQUE(idempotency_key)`, service-role-only writes, no UPDATE/DELETE RLS).
- **Migrations:** `supabase/migrations` — **291** additive-only files (guarded by `_reusable-migration-guard.yml` + `make rls-check`). Trading module has a **separate** golang-migrate schema in its own Postgres (5 migrations, reversible `.down.sql`).
- **Cache/locks/queues:** Redis (`internal/platform/redis`) for idempotency fast-path, Redlock advisory locks, asynq queue. ES for marketplace search. Cron via profile-gated compose services + systemd (OSRM).
- **Events:** webhook-driven (HMAC-verified) status transitions; append-only audit logs (`crypto_audit_log`, `kyc_events`); no central event bus.

### A.6 Auth, permissions, providers

- **Auth:** Supabase JWT. Main backend `RequireAuthContext` + `RequirePermission`. Trading module HS256 (alg-pinned) **or** RS256/JWKS with rotation; **dev bypass to `demo-user` when secret unset**.
- **RBAC:** main backend permission slugs seeded by migration, fail-closed 403. Trading module: capability matrix (`admin/rbac.go`) but admin role via **`X-Admin-Role` header** (client-asserted).
- **Providers present:** Paystack, Monnify, Maplerad (WaaS), Eversend (unwired), Dojah/Smile/Youverify (KYC). **No Quidax, no Alpaca, no Fireblocks/BitGo** — named only as future intent.

### A.7 KYC / AML / Onboarding

- `kycverify`: CBN tiered check-sets (Tier1 ID → Tier2 facial/liveness → Tier3 document+**AML**), multi-provider failover with per-`(provider,check)` circuit breaker, confidence→REVIEW gating, NDPA/CBN consent capture. BVN/NIN stored as argon2id hash.
- **Onboarding is fragmented:** invest eligibility (`/api/v1/invest/*`), identity KYC (`/api/finance/kyc`, Dojah), FX KYC (Maplerad) are three separate funnels; crypto trading currently borrows the FX KYC flow.

### A.8 Feature flags, infrastructure, deployment, testing

- **Feature flags:** main backend ~40 `Feature*Enabled` (default OFF, validated). Trading module flags exist as **admin toggles but are never consulted by trade paths** (no kill-switch enforcement).
- **Infra:** Docker (backend multi-binary; **crypto-backend is distroless/nonroot — the best image in the repo**), docker-compose (two, separate DBs), 22 GitHub workflows (strong verify lanes), **cPanel/Passenger** as the only real prod deploy; `deploy.yml` container/blue-green pipeline is **all `echo TODO` stubs**. **No Terraform/Helm/K8s.**
- **Observability:** trading module has metrics/tracing/health wired end-to-end; **main money backend has none**.
- **Testing:** 253 Go tests in main backend (ledger/settlement/fee invariants, live-DB suites), 42 frontend-web vitest specs, 15 mobile Playwright e2e; **crypto-backend 15 tests with no CI**. Repo-wide `ci.yml` runs only `build`+`vet` (no `go test`).

---

## Part B — Dependency Graph

Format: **Module → Dependencies → Consumers → Side Effects**

```
finance/ledger  (THE MONEY CORE)
  ├─ deps:      platform/db (pgxpool), platform/redis (Redlock, optional)
  ├─ consumers: wallet, fx, va, transfers, settlement, maplerad, crypto, referrals, edtech/fees
  └─ effects:   immutable ledger_entries; advisory xact lock "wallet:<userID>";
                idempotency UNIQUE; balance is a projection (never stored)

finance/wallet
  ├─ deps:      ledger, tiers
  ├─ consumers: transfers, va, bills, votes, most money paths
  └─ effects:   tier-limit enforcement (fail-closed) before ledger.Debit

finance/tiers
  ├─ deps:      ledger (projects daily DEBITs), config(FeatureTierLimitsEnabled)
  ├─ consumers: wallet.Debit, maplerad gate
  └─ effects:   fail-closed daily/balance caps (CBN bands)

finance/fx
  ├─ deps:      ledger, provider/maplerad, redis (quote reservation)
  ├─ consumers: fx handlers, currency_wallets
  └─ effects:   2 ledger legs + currency_wallets MIRROR (stored projection, not journaled)

finance/{va,transfers,settlement,maplerad}
  ├─ deps:      ledger, provider/{paystack,monnify,maplerad,eversend}, provider/disbursement/registry
  ├─ consumers: money handlers, merchant/marketplace settlement
  └─ effects:   guarded FSMs, per-leg idempotency keys, reversal-only corrections

finance/kycverify
  ├─ deps:      provider KYC ports (Dojah/Smile/Youverify), gateway circuit breaker
  ├─ consumers: kyc.Service, tier upgrades, va provisioning
  └─ effects:   tier verification, AML/PEP at Tier3, human-review halts

backend/internal/crypto   (CRYPTO #1 — ledger-integrated)
  ├─ deps:      finance/ledger (NGN cash legs), mock Price/Withdrawal providers, onchain webhook
  ├─ consumers: crypto handlers, admin crypto console
  └─ effects:   crypto_holdings projection (NOT double-entry), AML-gated withdrawals,
                custody reconciliation (read-only), fatal-on-fail audit

──────────────────────  SEPARATE MODULE / SEPARATE DB  ──────────────────────

paymax/crypto-backend :: store.Repository   (CRYPTO #2 + STOCKS — standalone)
  ├─ deps:      pgstore.Store (wired) | store.PgRepository (unwired) | store.Store (memory);
                adapter.{MarketData,Liquidity,Custody} → mock | httpadapter
  ├─ consumers: mobile app/crypto, app/stocks, app/invest; admin crypto/invest consoles
  └─ effects:   single-row "ledger" (not balanced), demo-user single-tenant,
                instant "Filled" fills (no real settlement), quote consume-once

paymax/crypto-backend :: stocks.Service   (STOCKS — mock island)
  ├─ deps:      mockdata.go only
  ├─ consumers: app/stocks, app/invest
  └─ effects:   seeded positions never move on fills; no ledger; not eligibility-gated

CLIENTS
  mobile src/api/client.ts → EXPO_PUBLIC_API_BASE_URL → frontend-web proxy → GO_BACKEND_URL(:8080)
  frontend-web app/api/v1/{crypto,stocks,invest}/[...] → go-backend.ts (pure proxy)
  frontend-admin *AdminService.ts → :8080/api/v1/{admin/crypto, admin/invest, finance/*}
```

**Critical dependency observations:**
- **Two crypto stores, no shared ledger.** `backend/internal/crypto` reuses `finance/ledger`; `paymax/crypto-backend` has its own single-row ledger in its own DB. They do not reconcile.
- **Stocks has zero money-core dependency** — it is a mock slice with no ledger.
- **The trading module's mature persistence (`store.PgRepository`, per-user + serializable + ledger-derived) is unwired**; the weaker `pgstore.Store` (demo-user, `wallet_balances`) is what runs.

---

## Part C — Missing Capabilities Report (vs Quidax Enterprise + Alpaca Brokerage)

Legend: **E**=Exists · **R**=Needs Refactor · **X**=Needs Extension · **M**=Missing · **♻**=Reuse as-is

### C.1 Quidax (crypto / African fiat / merchant / treasury)

| Capability | State | Evidence / Path | Notes |
|---|---|---|---|
| Double-entry ledger / treasury accounts | ♻ **E** | `finance/ledger`, `AccountType` (revenue, fx_spread, settlement, suspense) | Reuse as the single ledger for everything |
| NGN wallet + virtual accounts (pay-in) | ♻ **E** | `finance/wallet`, `finance/va.GetOrProvision` | |
| Fiat payouts w/ multi-provider failover | ♻ **E** | `provider/disbursement/registry.InitiatePayoutFailover` | |
| Merchant settlement + revenue split | ♻ **E** | `finance/settlement.Settle`, `Split.Validate` | |
| Tiered KYC/AML + sanctions/PEP | ♻ **E** | `finance/kycverify` (Tier3 AML) | |
| Crypto buy/sell/swap + holdings | **R** | `backend/internal/crypto` **and** `paymax/crypto-backend` | **Two impls — consolidate** |
| Whitelisted withdrawals + AML gate | **E** | `crypto/service_ext.go` (pending_review gate) | In money-core impl only |
| Custody reconciliation | **E** | `crypto/onchain.go` (read-only diff) | Mock custodian |
| FX quote→convert | **E/R** | `finance/fx` | NGN↔USD/GBP/EUR; not true multi-ccy double-entry |
| **Stablecoin rails (USDT/USDC) as fiat-equiv** | **M** | USDT is only a mock-priced asset | Net-new: stablecoin accounts, on/off-ramp |
| **Multi-currency African fiat (KES/GHS/ZAR)** | **M** | Everything hardcoded NGN (`maplerad.go`) | Net-new: currency model + rails |
| **Cross-border remittance corridors** | **M** | `eversend` adapter exists but unwired | Net-new: corridor/beneficiary model |
| **Real on-chain custody (Fireblocks/BitGo)** | **M** | mock `WithdrawalProvider`/`PriceProvider` | Adapter behind existing seam |
| **Sub-wallets / merchant / treasury / hot-cold** | **X** | `AccountType` segregation exists | Extend account taxonomy |
| **Multi-chain asset + deposit detection** | **X/M** | deterministic mock addresses | Needs custody provider + chain webhooks |
| **True multi-currency double-entry** | **M** | ledger is kobo-only; FX/crypto are mirrors | Ledger extension (currency dimension) |
| Crypto payroll / bulk payouts / collections | **M/X** | disbursement rails exist | Extend on existing payout engine |

### C.2 Alpaca (US equities / ETFs / options / market data / analytics)

| Capability | State | Evidence / Path | Notes |
|---|---|---|---|
| Stock list / order draft / estimate | **E** | `stocks.Service`, `stocks/engine.BuildEstimate` | **Mock data only** |
| Order types (market/limit) | **E/R** | `stocks.PlaceOrder` | market→Filled, limit→Submitted; no stop/trailing |
| Public offers (IPO/rights) | **E** | `stocks.ApplyToOffer` | |
| Invest eligibility / suitability / agreements | ♻ **E** | `engine.EvaluateEligibility`, `/api/v1/invest/*` | Reuse; unify KYC funnel |
| **Live market data / real-time quotes / streaming** | **M** | `mockdata.go`, deterministic charts | Net-new: MarketData provider (Alpaca) |
| **Brokerage account model** | **M** | positions seeded, single-user | Net-new |
| **Order-execution provider seam (async fills)** | **M** | fills simulated in store; no `Execute`/`PlaceOrder` provider method | **Design blocker for Alpaca** |
| **Fractional shares** | **X** | minor-unit money exists | Extend order/position model |
| **Options** | **M** | equities only | Net-new |
| **Stop / trailing-stop / recurring orders** | **M** | market/limit only | Extend order engine |
| **Dividends / corporate actions** | **E(stub)/X** | endpoints exist, mock payloads | Wire to provider |
| **Portfolio performance / PnL / buying power / margin** | **X/M** | positions computed on read | Extend; no margin |
| **Tax lots / statements / trade confirmations** | **M** | — | Net-new (compliance docs) |
| **Market news / research / watchlists / alerts** | **E(crypto)/M(stocks)** | crypto watchlist/alerts exist | Extend to equities + unify |
| Stocks ledgered / double-entry | **M** | no ledger for stocks | Route through money-core ledger |
| Stocks eligibility-gated | **M** | only crypto is gated | Extend gate to equities |

### C.3 Cross-cutting platform gaps (both)

| Capability | State | Notes |
|---|---|---|
| **Unified portfolio (crypto+stocks+cash net worth)** | **M** | Three separate portfolios today; no aggregate view |
| **Unified wallet (multi-asset ledger)** | **X** | Money-core ledger is the right home; trading module bypasses it |
| Provider abstraction (crypto read/quote/custody) | **E/X** | `adapter.*` seam exists; needs execution + broker + KYC + funding seams |
| Observability (main backend) | **M** | No Prometheus/OTel/structured logs/dashboards |
| IaC / K8s / Helm / Terraform | **M** | None; cPanel-only prod |
| Secrets manager / key rotation / HSM | **M** | Plain env; **leaked snapshots in history** |
| MFA / passkeys / step-up auth | **M** | Anomaly heuristics exist, no MFA |
| CI test gate (repo-wide `go test`) | **X** | Only build+vet globally; crypto-backend no CI |
| Coverage ≥95% | **M** | No coverage threshold enforced |

---

## Part D — Critical Findings & Risks (ranked)

1. **SECURITY — leaked `.env_*.local` snapshots tracked in git.** ~50 files under `.history/` and `.agentwork/*/.history/frontend-web/` were committed before `.gitignore` was hardened. **Action:** `git rm --cached` + history purge (git-filter-repo/BFG) + **rotate every affected credential**. Do not defer.
2. **Duplicate crypto subsystems.** `backend/internal/crypto` (ledger-integrated, AML-gated) vs `paymax/crypto-backend` (mock-first, own DB). Decide the canonical home before building Quidax features, or the AML gate and custody reconciliation will diverge.
3. **Duplicate persistence in the trading module.** `pgstore.Store` (`wallet_balances`, `demo-user`) is wired; the superior `store.PgRepository` (per-user, serializable, ledger-derived) is not. One must win.
4. **Identity doesn't reach persistence** in the trading module → no real multi-tenancy, per-user balances, or per-user idempotency in the running path.
5. **No execution/broker/funding provider seam.** Fills are instant bookkeeping; stocks are mock. Alpaca and a real crypto venue need an `Execute`/order-lifecycle interface + webhook-driven settlement FSM before they can plug in.
6. **Observability inversion.** The mock trading service has metrics/tracing; the real money backend has none. SLOs/on-call for the money path are impossible today.
7. **Deployment not production-grade at scale.** cPanel/Passenger single-box; container/blue-green pipeline is stubbed; no IaC/K8s/secrets manager/MFA.
8. **Trading module hardening.** `demo-user` auth bypass when secret unset, `Access-Control-Allow-Origin: *`, header-asserted admin role, unwired circuit breaker — must never reach prod.
9. **Feature flags not enforced** on trade paths (no kill-switch).
10. **CLAUDE.md is materially stale** (claims "no backend tests / 65 migrations"; reality is 253 tests / 291 migrations) — update to prevent mis-scoped work.

---

## Part E — Recommended Phase 2+ Sequencing (proposal — awaiting direction)

Per the instruction, **no code has been changed.** The mega-plan (Phases 2–16) is a multi-quarter program; attempting it as one pass would violate "never introduce parallel systems / always extend." The audit shows the highest-leverage, lowest-risk path is **consolidate first, then abstract, then extend**:

**Stage 0 — Stop the bleeding (days):** purge + rotate leaked secrets (#1); fix trading-module prod-hardening (auth bypass, CORS, admin role) behind config; update CLAUDE.md.

**Stage 1 — Decide the canonical architecture (design, no big code):**
- Pick the **single ledger** (recommend `finance/ledger`) and the **single crypto home**.
- Decide whether the trading module (`paymax/crypto-backend`) becomes (a) the front-door trading service that posts money legs through the money-core ledger via an API, or (b) is folded into `spotlight/backend`. This is the pivotal decision — everything downstream depends on it.

**Stage 2 — Provider abstraction (Phase 3):** design the missing seams — `BrokerageProvider` (execution/order-lifecycle), `MarketDataProvider`, `CustodyProvider` (real), `FiatProvider`/on-ramp, extending the existing `internal/provider` port style. Adapters: **Quidax** (crypto/liquidity/custody), **Alpaca** (brokerage/market-data). Business logic never imports a concrete SDK.

**Stage 3 — Unify wallet & portfolio (Phases 6–7):** route stocks through the money-core ledger; build one aggregate net-worth/allocation surface; consolidate the duplicate `invest/` vs `stocks/` mobile features.

**Stage 4 — Extend features (Phases 4–5):** Quidax rails (multi-currency, stablecoins, cross-border) and Alpaca features (live data, fractional, options, analytics) — each additive behind flags + tests.

**Stage 5 — Platform hardening (Phases 9–15):** observability (OTel/Prometheus/Grafana on the money backend), IaC/K8s/Helm, blue-green/canary, secrets manager, MFA/passkeys, ≥95% coverage gate.

Every stage keeps existing APIs working, adds tests + telemetry + docs, and touches one bounded context at a time.

---

*End of Phase 1 audit. Awaiting a scope/sequencing decision before any Phase 2 code changes.*
