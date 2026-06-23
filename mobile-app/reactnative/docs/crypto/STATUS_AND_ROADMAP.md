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
| Persistence | 🟡 Repository interface seam + Postgres schema/migrations done (`internal/store/repository.go`, `migrations/`). Remaining: implement the Postgres `Repository` + Redis for quotes/idempotency, wire in `main.go` | **P0** |
| Auth | 🟡 HS256 JWT verification + middleware done (`internal/auth`, `SUPABASE_JWT_SECRET` enforces; dev fallback to demo user); userId on request context. Remaining: per-user data scoping (lands with Postgres `Repository`), RS256/JWKS variant | **P0** |
| Real adapters | Implement Liquidity/Custody/MarketData against real providers (sandbox first) behind the existing interfaces | **P0** |
| Quote integrity | Persist server quotes; execute strictly by `quote_id` with real expiry (today the server re-prices) | P1 |
| KYC / suitability / agreements | Wire the real eligibility gate (today it returns `eligible`) to KYC tier + suitability + agreement acceptance | **P0** |
| Withdrawals | Real address screening (AML/sanctions), cooling-period enforcement, admin approval queue, on-chain broadcast | **P0** |
| Webhooks | Provider webhooks (fill, deposit-detected, withdrawal-confirmed) with signature verification + replay prevention | **P0** |
| Reconciliation | Daily ledger ↔ provider balance reconciliation + exception queue | P1 |
| Money math | Decide true crypto precision (8dp) vs the 2dp UI shortcut; audit rounding end-to-end | P1 |
| Observability | Structured logs, metrics, tracing, error monitoring; rate limiting; circuit breakers | P1 |
| Mobile hardening | Surface server error messages on failed screens; biometric auth (not just PIN); push notifications for alerts/withdrawal status | P1 |
| Tests | API contract tests, integration tests (KYC→trade, funding→order), security tests (idempotency replay, webhook spoofing, balance tamper) per `acceptance.md` | P1 |
| DevOps | ✅ Dockerfile (distroless nonroot) + CI (vet/test/build/govulncheck + image/Trivy scan) + compose done. Remaining: env/secrets management, staging→prod promotion, deploy + rollback | P1 |

---

## 3. Gap B — full Paymax Invest product

The docs describe a multi-asset product; crypto is one vertical. Largely **not started**:

| Module | Status | Notes |
|---|---|---|
| Stock trading | 0% | Entire parallel surface: discovery, detail, market/limit orders, public offers, rights issues, dividends, corporate actions, settlement |
| Onboarding / KYC / suitability / agreements | 0% | Invest-specific onboarding, suitability questionnaire, agreement versioning + acceptance logs |
| Wallet & funding | ~0% | Ledger-based invest wallet, deposits/withdrawals to bank, FX, virtual accounts (crypto reuses a stubbed `investableBalance`) |
| Learn Center | 0% | Lessons, quizzes, paths, glossary, risk simulator, demo trading |
| AI education assistant | 0% | Guardrailed explain-asset/order/portfolio |
| Spotlight Wealth | 0% | Creator finance content, learn-and-earn, campaigns |
| Security / support / settings (invest) | ~0% | Change PIN, device mgmt, disputes, fee schedule, statements, close account |
| Admin console (~224 screens) | 0% | Separate Vue/Quasar app: asset control, order monitoring, KYC/AML review, fees/limits, provider health, reconciliation, audit, RBAC + maker-checker |
| Backend services (~26) | ~5% | Today: one consolidated mock crypto service. Needs the full service split + real data stores + Kafka/NATS |

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
