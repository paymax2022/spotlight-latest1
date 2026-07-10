# Phase 2 — Consolidation & Provider-Abstraction Design

**Status:** Design (Stage 1). Governs later implementation stages. Supersedes ad-hoc
integration. Companion to `docs/audit/PHASE-1-FINTECH-PLATFORM-AUDIT.md`.
**Decision locked (per product direction):** *Money-core is the single ledger; the
trading module is the front door.* Provider integrations are scaffolded as
interfaces with mock adapters (no vendor secrets required to make progress).

---

## 1. Target architecture (the north star)

```
                    ┌─────────────────────────────────────────────┐
   Mobile / Admin ──▶  ONE /api/v1 trading gateway (front door)    │
                    │  paymax/crypto-backend (market data, quotes, │
                    │  order intake, portfolio read models)        │
                    └───────────────┬─────────────────────────────┘
                                    │ money legs only (HTTP, signed, idempotent)
                                    ▼
                    ┌─────────────────────────────────────────────┐
                    │  spotlight/backend  finance/ledger           │
                    │  = SINGLE SOURCE OF TRUTH for balances       │
                    │  (double-entry, derived balances, reversals) │
                    └───────────────┬─────────────────────────────┘
                                    │ ports (never concrete SDKs)
        ┌───────────────┬───────────┴───────────┬───────────────┐
        ▼               ▼                       ▼               ▼
  MarketDataProvider  BrokerageProvider   CustodyProvider   FiatProvider
   (Alpaca, crypto     (Alpaca equities,   (Fireblocks/BitGo, (Paystack,
    feeds)              crypto venue)        Quidax custody)    Maplerad…)
        │               │                       │               │
   mock adapters now → real adapters when credentials/sandbox available
```

**Invariants that do not change:** integer minor units everywhere; every money
mutation posts a balanced double-entry pair to `finance/ledger` with an
`Idempotency-Key`; balances are projections (never stored/updated); corrections are
reversing entries only; feature-flag every new capability; additive-only migrations.

---

## 2. The four consolidation decisions

### D1 — One ledger. `finance/ledger` is authoritative.
The trading module (`paymax/crypto-backend`) must **stop being its own bank**. Its
three divergent stores (`store.Store` memory, `pgstore.Store` on `wallet_balances`,
`store.PgRepository` ledger-derived) collapse to: **read models it owns** (positions,
orders, quotes, watchlists) + **money legs posted to `finance/ledger` via an API**.
- Cash/crypto/stock balances derive from the money-core ledger, not `wallet_balances`.
- The mature `store.PgRepository` (per-user, serializable, ledger-derived) becomes the
  template for the read-model persistence; the weaker `pgstore.Store` is retired.
- **Migration path:** introduce a `LedgerClient` port in the trading module that calls
  the money core; behind it, a `mockLedger` (today's behavior) and a `httpLedger`
  (real). Flip per-environment. No big-bang rewrite.

### D2 — One crypto home.
`backend/internal/crypto` (ledger-integrated, AML-gated withdrawals, custody
reconciliation, fatal-on-fail audit) is the **canonical crypto money engine**. The
trading module's crypto becomes a **front-of-house**: market data + quotes + order
intake, delegating settlement/holdings to the canonical engine via ports. Deposit
detection, withdrawal AML gate, and custody recon live once, in the money core.

### D3 — Stocks join the ledger.
Equities today are a mock island (no ledger, positions never move, not
eligibility-gated). Target: stock buys/sells post cash legs through `finance/ledger`
(new `AccountType`s as needed, additive), positions become ledger-backed read models,
and the **same `engine.EvaluateEligibility` gate** applies to equities as to crypto.

### D4 — One trading surface (retire the duplicate).
Mobile has `invest/` and `stocks/` — two equities front-ends. Consolidate to one
feature module + one unified portfolio. Admin's `crypto` and `invest` control planes
stay as views but read from the unified backend.

---

## 3. Provider abstraction (Phase 3 — interfaces first, mocks now)

New ports, following the existing `backend/internal/provider` port style
(capability-scoped, domain depends on the port, never the adapter). Business logic
must never `import` a Quidax or Alpaca SDK.

```go
// MarketDataProvider — quotes, candles, streaming, corporate actions, news.
type MarketDataProvider interface {
    Assets(ctx) ([]Asset, error)
    Quote(ctx, symbol) (Quote, error)
    Candles(ctx, symbol, interval, range) ([]Candle, error)
    // Phase 2+: Stream(ctx, symbols) (<-chan Tick, error)
}

// BrokerageProvider — the seam that is MISSING today (fills are simulated).
// Order lifecycle is async: submit → provider order id → webhook-driven fills.
type BrokerageProvider interface {
    PlaceOrder(ctx, OrderRequest) (ProviderOrder, error)   // returns provider order id + accepted status
    CancelOrder(ctx, providerOrderID) error
    GetOrder(ctx, providerOrderID) (ProviderOrder, error)
    ParseWebhook(ctx, headers, body) (OrderEvent, error)   // fill/partial/reject/settled
}

// CustodyProvider — real crypto custody (deposit addr, withdrawal broadcast, screening).
type CustodyProvider interface {
    DepositAddress(ctx, userID, asset, network) (Address, error)
    Withdraw(ctx, WithdrawRequest) (ProviderWithdrawal, error) // called ONLY after AML approval
    ScreenAddress(ctx, address, network) (Screening, error)
    ParseWebhook(ctx, headers, body) (ChainEvent, error)       // deposit.confirmed, withdrawal.*
}

// FiatProvider — on/off-ramp funding (already partly exists as PaymentProvider).
type FiatProvider interface {
    Fund(ctx, FundRequest) (Intent, error)   // card/bank pay-in → ledger credit on webhook
    Payout(ctx, PayoutRequest) (Transfer, error)
    ParseWebhook(ctx, headers, body) (FiatEvent, error)
}
```

**Adapters (delivery order):**
1. `mock*` adapters (extract today's `engine`/`stocks` mock behavior behind the ports) — unblocks all downstream work with zero secrets.
2. **Alpaca** → `MarketDataProvider` + `BrokerageProvider` (sandbox first).
3. **Quidax** → `MarketDataProvider` (crypto) + `CustodyProvider`/`FiatProvider` (rails).
4. Future: Fireblocks/BitGo (custody), Binance/Kraken/Coinbase (liquidity), IBKR/DriveWealth (brokerage) — each a new adapter, no business-logic change.

**Resilience:** wrap every provider call in the module's already-built (but currently
**unwired**) `internal/circuitbreaker` + a retry/backoff policy, and reuse the money
core's failover-registry pattern (`provider/disbursement/registry.go`) for multi-provider.

---

## 4. Unified wallet & portfolio (Phase 6–7)

- **One wallet** = the money-core ledger, presented as multi-asset (cash NGN/FX,
  stablecoins, crypto holdings, stock positions) with the pending/available/reserved
  states modeled as standing accounts (as the ledger already does for escrow/suspense).
- **One portfolio** = a read model that aggregates, per user: cash + crypto + stocks
  → net worth, allocation %, daily/monthly/yearly gain, risk score. New endpoint
  `GET /api/v1/portfolio` (the true aggregate the audit found missing) feeding a single
  mobile "Net worth" surface that replaces the three separate portfolio screens.

---

## 5. Stage 0 hardening applied in this pass (already done)

Trading-module (`paymax/crypto-backend`) production-safety fixes, backward-compatible:

| Change | Before | After | Env |
|---|---|---|---|
| Auth dev bypass | `secret==""` → everyone is `demo-user` | fail-closed 401 unless explicitly enabled | `ALLOW_DEV_AUTH=true` (dev only) |
| CORS | `Access-Control-Allow-Origin: *` always | origin echoed only if in allowlist; safe localhost default | `CORS_ALLOW_ORIGINS=comma,list` |
| Admin role | trusts client `X-Admin-Role` header | prefers verified JWT `role` claim; header only behind trust flag | `TRUST_ADMIN_ROLE_HEADER=true` (trusted proxy) |
| JWT role | not threaded | `auth.Role(ctx)` available to handlers | — |

New tests: fail-closed-when-unconfigured, dev-fallback-only-when-allowed, role-threaded-from-claims.
Also: leaked `.env` snapshots untracked (see `docs/runbooks/SECRET-ROTATION.md`); CLAUDE.md facts corrected.

**Operators must set in production:** `SUPABASE_JWT_SECRET` (or `SUPABASE_JWKS_URL`),
`CORS_ALLOW_ORIGINS` (real origins), and leave `ALLOW_DEV_AUTH` / `TRUST_ADMIN_ROLE_HEADER`
unset unless a trusted proxy injects the role.

---

## 6. Rollout sequence (each stage additive, flagged, tested)

1. **Stage 0 (done):** security hardening + secret cleanup + doc correction.
2. **Stage 2 — Provider seams (mocks):** define the 4 ports, extract mock adapters, wire the circuit breaker; no behavior change, full test parity.
3. **Stage 1.5 — LedgerClient:** introduce the money-legs-to-ledger port in the trading module behind a flag; run mock ↔ http in parallel; reconcile.
4. **Stage 3 — Unify wallet/portfolio:** ledger-back stocks, build `GET /api/v1/portfolio` aggregate, consolidate `invest/`+`stocks/` UI.
5. **Stage 4 — Extend:** Alpaca adapter (live data + async fills), Quidax adapter (multi-currency, stablecoins, cross-border), each behind flags + tests.
6. **Stage 5 — Platform:** OTel/Prometheus/Grafana on the money backend, IaC/K8s/Helm, blue-green/canary, secrets manager, MFA/passkeys, ≥95% coverage gate.

**Guardrails at every stage:** existing APIs keep working; one bounded context at a
time; tests + telemetry + docs land with each change; no parallel systems introduced.

---

## 7. Open decisions to confirm before Stage 2

- **Trading module deployment:** stays a separate service (front door calling the money
  core over HTTP) vs. eventually folded into `spotlight/backend`. Design assumes the
  former (D1); revisit if a single deployable is preferred.
- **Ledger↔trading transport:** internal HTTP with signed service tokens vs. a shared
  Go package. HTTP keeps the module boundary clean and independently deployable.
- **Vendor selection timing:** when Alpaca/Quidax sandbox credentials are available,
  the mock adapters are swapped with zero business-logic change.

*This document is design only — no feature code was written in Stage 1.*
