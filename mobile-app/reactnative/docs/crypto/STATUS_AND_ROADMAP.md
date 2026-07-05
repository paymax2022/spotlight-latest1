# Paymax Invest · Crypto — Status & Roadmap

_Snapshot of what's built vs. the scope in `docs/crypto`, with the work remaining
to (A) production-harden the crypto slice and (B) reach full-product scope._

> **Headline:** the **crypto mobile slice is ~90% done** and wired to a mock Go
> backend; the **backend is a ~70% mock spine / ~15% production**; the **overall
> multi-asset Paymax Invest product is ~15%**. Everything shipped is **mock-first
> and not production**, and the Go service is **written & unit-tested but not yet
> compiled/run** in this environment.

---

## 1. What's built

### Mobile — crypto module (`app/crypto`, `src/features/crypto`)
35 screens, reusing the existing design tokens + shared components, mock-flagged
behind `invest_crypto`:

- Home, asset list (search/filter), asset detail (chart, stats, risk, about, networks)
- Buy / Sell / Swap — entry → review (fees + risk disclosure + PIN + quote countdown) → processing → success/failed
- Portfolio (allocation + holdings), transactions list + receipt (status timeline, provider ref)
- Watchlist, price alerts, address book, withdrawals (KYC/whitelist/screening/cooling/OTP → manual review), on-chain deposit (QR + memo)
- All 7 standard states; integer minor-unit money; React Query + idempotency keys

### Backend (`backend/`, Go, stdlib-only)
- Provider-adapter spine (MarketData · Liquidity · Custody) with mock adapters
- In-memory store with **double-entry ledger**, **idempotency cache**, **order state machine**, **server-side pre-trade checks**
- All 26 endpoints the app calls; quote/fee math ported 1:1 from the mobile so preview == execution
- Unit tests (engine math, ledger, pre-trade rejects, portfolio, idempotency) + `Makefile` + `smoke.sh`
- Mobile wired to it via `EXPO_PUBLIC_CRYPTO_USE_MOCK=false` + `EXPO_PUBLIC_API_BASE_URL`

---

## 2. Gap A — production-harden the crypto slice

Turn the working mock into something shippable. Roughly mapped to product phases 3–4.

| Area | Gap | Priority |
|---|---|---|
| Build verification | Run `make check` (vet + test + build) on a Go 1.22 host; fix anything | **P0** |
| Persistence | ✅ Repository seam + schema/migrations + two pgx impls: `pgstore` (single-user) and **`store.PgRepository` with per-user `ForUser` scoping + serializable-tx execution + JSONB quotes + ledger-derived cash balance**. `main.go` selects by `DATABASE_URL`. Remaining: Redis for hot quotes, pool tuning | P1 |
| Auth | ✅ HS256 + **RS256/JWKS** verification (`SUPABASE_JWKS_URL` selects RS256, else HS256 secret) + middleware; userId on request context; `PgRepository.ForUser(userID)` gives full per-user scoping (wire in middleware → handlers to activate) | ✅ |
| Real adapters | 🟡 **HTTP provider-adapter seam done** (`internal/httpadapter` implements MarketData/Liquidity/Custody; `PROVIDER=http` + `PROVIDER_BASE_URL`/`PROVIDER_API_KEY` selects it in `NewServer`). Remaining: a concrete provider's request/response mapping + sandbox validation | P1 |
| Quote integrity | 🟡 `PgRepository` persists quotes as JSONB + marks them consumed on execute (`consumed`/`expires_at`). Remaining: switch execute path to fetch strictly by `quote_id` instead of re-pricing | P1 |
| KYC / suitability / agreements | Wire the real eligibility gate (today it returns `eligible`) to KYC tier + suitability + agreement acceptance | **P0** |
| Withdrawals | Real address screening (AML/sanctions), cooling-period enforcement, admin approval queue, on-chain broadcast | **P0** |
| Webhooks | ✅ Signature verify (HMAC) + timestamp freshness + replay-dedup + signed-auth-exempt endpoint + full event routing: order.*/withdrawal.* → status mutation, deposit.confirmed → credit holding + history, **withdrawal.failed → auto-reversal (re-credit)**. Deposits/withdrawals are first-class records (mobile + backend). | ✅ |
| Reconciliation | ✅ `internal/recon` — ledger/holdings reconciliation with exception report, exposed at `GET /api/v1/crypto/admin/reconciliation`. Remaining: scheduled daily run + provider-balance source | 🟡 |
| Money math | Decide true crypto precision (8dp) vs the 2dp UI shortcut; audit rounding end-to-end | P1 |
| Observability | 🟡 Request-ID + access log, `/healthz` + dependency-checked `/readyz`, graceful shutdown, per-IP rate limiting, Prometheus `/metrics`, **request tracing (`internal/tracing`, `X-Trace-Id` propagation)**, and a tested circuit-breaker package. Remaining: alerting, distributed tracing export (OTel), wire breaker into `httpadapter` | P1 |
| Mobile hardening | 🟡 **Server error messages now surface on failed screens** (axios→`toCryptoError`, preserves `quote_expired`). Remaining: biometric auth (not just PIN); push notifications | P1 |
| Tests | API contract tests, integration tests (KYC→trade, funding→order), security tests (idempotency replay, webhook spoofing, balance tamper) per `acceptance.md` | P1 |
| DevOps | ✅ Dockerfile (distroless nonroot) + CI (vet/test/build/govulncheck + image/Trivy scan) + compose done. Remaining: env/secrets management, staging→prod promotion, deploy + rollback | P1 |

---

## 3. Gap B — full Paymax Invest product

The docs describe a multi-asset product; crypto is one vertical. Largely **not started**:

| Module | Status | Notes |
|---|---|---|
| Stock trading | 🟡 **mobile module (~20 screens) + Go backend** both built. Mobile: home, list+search+filter, detail, market+limit buy/sell, orders (cancel/timeline), portfolio, public offers; tsc-clean; flip `EXPO_PUBLIC_STOCKS_USE_MOCK=false` to go live. Backend: `internal/stocks` Service (assets/chart/news/dividends/corp-actions/portfolio/orders/cancel/offers/apply) + estimate engine + pre-trade checks + idempotency + tests, wired at `/api/v1/stocks/*` and `/portfolio?assetType=stock`. Remaining: real broker adapter, US-stock FX, Postgres persistence (in-memory today) |
| Onboarding / KYC / suitability / agreements | 🟡 mobile module built (`app/invest-onboarding`): intro, eligibility, KYC (personal/ID/selfie/review/submitted), suitability questionnaire→riskCategory, agreements accept, complete. Mock-first, tsc-clean. Remaining: real KYC provider + agreement versioning/acceptance logs + gate trading on it |
| Wallet & funding | ~0% | Ledger-based invest wallet, deposits/withdrawals to bank, FX, virtual accounts (crypto reuses a stubbed `investableBalance`) |
| Learn Center | 🟡 mobile module built (`app/learn`): paths, lesson reader, quizzes, glossary, progress. Mock-first, tsc-clean. Remaining: real content CMS, video, demo trading, risk simulator |
| AI education assistant | 🟡 mobile module built (`app/invest-ai`): guardrailed chat (refuses advice/predictions/guarantees, disclaimers), suggested questions, explain-asset. Mock-first, tsc-clean. Remaining: wire to a real guarded LLM + compliance logging |
| Spotlight Wealth | 🟡 mobile module built (`app/spotlight-wealth`): creator finance videos, literacy challenges (reward = wallet credit), learning leaderboard (not profit), reward wallet, campaigns + disclaimers. Mock-first, tsc-clean. Remaining: real content + campaign backend |
| Security / support / settings (invest) | 🟡 mobile module built (`app/invest-settings`): profile, KYC details, risk profile, linked banks, fee schedule, statements, security center (PIN/devices/sessions), support (FAQ/tickets). Mock-first, tsc-clean. Remaining: backend wiring |
| Admin console | 🟡 **built IN the monolith + LIVE**. Backend `internal/admin`: RBAC (8 roles × permission matrix), audit log, **maker-checker** approvals, reads across crypto+stocks+recon; 23 endpoints under `/api/v1/admin/*` (RBAC via `X-Admin-Role`). Mobile/web console (`app/admin`, runs on Expo web): dashboard, users+detail, KYC queue+review, asset controls (crypto+stock enable/disable/fees/limits), orders, withdrawal review, reconciliation, providers, risk limits, fees, feature flags, approvals, audit, settings/RBAC roster — ~17 screens, role-switcher, client+server permission gating, tsc-clean, `EXPO_PUBLIC_ADMIN_USE_MOCK`. Remaining: Postgres persistence of admin state, real admin auth (role from JWT not header) |
| Architecture | ✅ **monolith, built to scale** (per project intent): one Go service with clean internal packages (domain, store/pg, stocks, admin, auth, recon, metrics, tracing, ratelimit, circuitbreaker, httpadapter) + one Expo app with per-module feature folders. No microservice split / Kafka — intentionally a scalable monolith |

---

## 4. Suggested next steps (in order)

1. **Verify the backend** — `cd backend && make check` on a Go host; fix any compile/test issues.
2. **Persistence + auth** — Postgres/Redis behind the store interface; enforce the bearer token.
3. **One real provider** — wire a sandbox liquidity/custody provider behind the adapter interfaces; validate buy/sell end-to-end.
4. **Real compliance gate** — connect eligibility to KYC/suitability/agreements before enabling live trading.
5. **Admin (crypto subset)** — asset enable/disable, fee/limit config, withdrawal-review queue, audit log.
6. **Then** branch into stocks, learn, and the rest of the product per phases 5–6.

---

_Generated as a working tracker. Update the status columns as items land._
