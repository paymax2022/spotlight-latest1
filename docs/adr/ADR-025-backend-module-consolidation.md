# ADR-025 — Consolidate the two Go backends into one modular monolith

**Date:** 2026-08-04
**Status:** Proposed
**Deciders:** Platform team · Finance/Ledger · (pending) ledger-auditor sign-off · Trading/Invest
**Scope:** `backend/` (`spotlight/backend`) and `mobile-app/reactnative/backend/`
(`paymax/crypto-backend`); the two Postgres databases and their migration tooling;
the crypto/stocks/invest client surfaces. No code moves under this ADR — it records
the target architecture and the phased path. Implementation lands behind
`FEATURE_TRADING_ENABLED` in later PRs.

## Context

The repo currently ships **two independent Go modules**, documented in
`docs/audit/PHASE-1-FINTECH-PLATFORM-AUDIT.md`:

| | `spotlight/backend` (`backend/`) | `paymax/crypto-backend` (`mobile-app/reactnative/backend/`) |
|---|---|---|
| Size | ~289K LOC | ~11K LOC |
| Role | Super-app money core: ledger, wallet, KYC, FX, VA, transfers, settlement, **and its own** `internal/crypto` | Standalone trading engine: crypto + stocks + portfolio + invest eligibility + admin plane |
| Money model | **Genuine double-entry**, NGN kobo, TOCTOU-safe, idempotent | **Single-row ledger, not truly balanced**; hardcoded `demo-user` |
| Data | Supabase Postgres, 291 additive migrations | **Its own Postgres**, golang-migrate, 5 migrations |
| Observability | **None** | **Full** (Prometheus, tracing, health, rate-limit, circuit breaker) |
| Admin/compliance | RBAC + audit across modules | **Institutional admin plane** (four-eyes maker-checker) + **fail-closed pre-trade eligibility gate** |
| CI/Deploy | Mature multi-lane CI; cPanel/Passenger | **No CI, no deploy**; distroless/nonroot image (best in repo) |

Three facts drive this decision:

1. **The split is a provenance artifact, not a bounded-context design.** The trading
   engine was built as a standalone prototype (mock-first providers, `demo-user`, its
   own DB + migration tool) in parallel with the money core, which independently grew
   its **own** ledger-integrated `backend/internal/crypto`. The result is duplication:
   the audit states **"crypto exists twice … stocks exist as a third, mock-only
   island,"** and concludes the work ahead is **"consolidation and provider
   abstraction, not greenfield construction."**

2. **The real problem is money integrity, not tidiness.** The trading module keeps a
   single-row, un-balanced ledger with a hardcoded `demo-user` and makes **no calls
   into the money core's double-entry ledger**. That violates the platform iron rule —
   *wallet balances are projections of the ledger; there is no separate money store.*
   A trade that settles only in the trading DB has **no balanced posting in the ledger
   of record**, which is unacceptable for production money.

3. **"One module vs two" conflates three independent axes.** They should be decided
   separately:

   | Axis | What it is | Today | Target |
   |---|---|---|---|
   | **Go module** (`go.mod`) | dependency/versioning boundary | 2 | **1** |
   | **Deployable** (`cmd/*` binary) | a process you run | main module already builds `server`, `marketplace-cron`, `marketplace-indexer`, `transport-scheduler`, … | 1..N as needed |
   | **Database** | data store + migration tool | 2 (Supabase + golang-migrate) | **1 source of truth** (ledger DB) |

   You do **not** need two modules to get independent deployability or scaling — the
   main module already proves one module → many binaries.

## Decision

Adopt a **modular monolith**: one Go module, one ledger database of record, trading as
an internal domain package, with the option (not the requirement) of a separate deploy
binary.

1. **One Go module — `spotlight/backend`.** The domain homes already live here and are
   ledger-integrated (see the Addendum): **`internal/crypto`** (canonical, AML-gated
   crypto), **`internal/invest`** (canonical "Paymax Invest" stocks, `InvestLedger`
   balanced pairs + provider ports), and **`internal/trading`** (custodial NAV fund).
   Consolidation reuses these — it does **not** create a new `internal/trading`
   umbrella. The standalone `paymax/crypto-backend` is treated as a *feature source*
   (unique assets to harvest) and then retired, not a parallel truth. Every trade
   already is — and stays — a balanced double-entry posting (DR/CR, kobo integers,
   `Idempotency-Key`, audit event, tier-limit fail-closed).

2. **One primary Postgres — the ledger DB.** Trading positions/orders and wallet
   balances become transactionally consistent under one store. Fold the 5 trading
   migrations into the additive Supabase migration set (namespaced under a `trading`
   schema or `trading_*` table prefix); **retire golang-migrate**. All new trading
   tables follow the additive-only + RLS conventions and the migration guard.

3. **Keep the option of a separate deploy binary.** If/when a workload needs to scale
   independently, add `backend/cmd/trading-server/` — **same module, shared
   `internal/*` packages, same DB** (or a read replica for hot reads), feature-flagged.
   This yields process isolation without splitting the codebase or the money.

4. **Harvest the trading service's strengths — do not merely delete it.** The audit
   names assets the main backend *lacks*: full observability (Prometheus/tracing/health),
   the distroless/nonroot Docker image, the institutional admin plane (RBAC +
   four-eyes maker-checker + append-only audit), and the fail-closed pre-trade
   eligibility gate (`engine.EvaluateEligibility`). Migrate these **into** the main
   backend as part of consolidation; they are net upgrades to the money core.

5. **Feature-flag the whole surface.** Trading mounts behind `FEATURE_TRADING_ENABLED`
   (default OFF) until the consolidated path is proven, per "no flag, no merge."

## Addendum (2026-08-04) — the target homes already exist; this is reconcile-and-retire, not scaffold

A code check while scoping P0/P1 corrected a premise of the first draft: the main
module **already contains ledger-integrated homes** for every domain the standalone
service covers. There is **no boundary to scaffold** — building a fresh
`internal/trading` skeleton would be duplicate/dead code. The consolidation is
therefore *reconcile the standalone's genuinely-unique assets into the existing homes,
then retire the standalone* — not "integrate the ledger" (already done).

**Reconciliation map — standalone `paymax/crypto-backend` → existing main-module home:**

| Standalone component | Main-module home (exists today) | Ledger-integrated? | Real gap to close |
|---|---|---|---|
| crypto buy/sell (`internal/domain`, mock-first, `demo-user`) | **`internal/crypto`** — AML-gated, custody reconciliation, `crypto.Register(...)`, gated `FEATURE_CRYPTO_ENABLED` | **Yes** (canonical) | none — canonical; retire the standalone crypto |
| stocks (`internal/stocks`: `MockBroker`, engine, mockdata) | **`internal/invest`** ("Paymax Invest") — `InvestLedger` posts balanced immutable pairs, `MarketDataAdapter`/`BrokerAdapter` ports, dividends + corporate actions, reconciliation, `FEATURE_INVEST_ENABLED` | **Yes** | standalone is *less* complete; fold any unique asset/broker data, then retire |
| unitized-NAV fund | **`internal/trading`** (custodial AI-fund, paper mode, cash strictly via ledger; `AccountTradingFundClearing`/`AccountTradingFeeIncome` already exist) | **Yes** (paper) | none |
| fail-closed pre-trade eligibility (`engine.EvaluateEligibility`) | verify against `internal/invest` + `finance/tiers` + KYC gates | partial/verify | **port the gate if absent** |
| institutional admin plane (RBAC + four-eyes maker-checker + append-only audit) | `ADR-005-maker-checker` + per-module audit | verify parity | adopt for trading admin if richer |
| observability (Prometheus/tracing/health/rate-limit/circuit-breaker) | **none in the main backend** | — | **port as cross-cutting `platform/observability`** |
| distroless/nonroot image | main uses a multi-binary image | — | adopt the image |

Net: the money-integrity fix the first draft framed as P1 ("route trades through the
ledger") is **already implemented** in `internal/crypto` and `internal/invest`. The
standalone is the prototype, not the truth. So P0/P1 below are re-scoped to *verify
parity and close the specific gaps*, and P3's "fold stocks/invest" collapses into
"retire the standalone once parity is confirmed."

## Migration plan (strangler-fig, phased — not big-bang)

Each phase is independently shippable, flag-gated, and keeps the trading + ledger test
suites green. No phase removes the standalone service until its replacement is proven.

- **P0 — Parity audit + canonical decision (no new code).** Ratify the reconciliation
  map above: `internal/crypto` and `internal/invest` are canonical; the fund is
  `internal/trading`. Enumerate the standalone's genuinely-unique assets (observability,
  admin plane, eligibility engine, distroless image). Deliverable is this map, not a
  package skeleton. The existing `FEATURE_TRADING_ENABLED` / `FEATURE_CRYPTO_ENABLED` /
  `FEATURE_INVEST_ENABLED` flags stay as the seams.
- **P1 — Close ledger/feature parity gaps (NOT re-integrate the ledger).** Confirm every
  standalone money path has a ledger-integrated equivalent in the canonical homes (it
  does for crypto/stocks); port the **fail-closed pre-trade eligibility gate** into
  `internal/invest`/`internal/crypto` only if a parity check shows it is missing.
  Any new money movement follows the balanced reserve→settle/reverse pattern of the
  restaurant withdrawal slice. **Request ledger-auditor sign-off on the parity check.**
  There is no `demo-user` ledger to delete in the main module — it lives only in the
  standalone, which P6 removes wholesale.
- **P2 — Schema move.** Port the 5 trading tables into additive Supabase migrations
  (`trading` schema), with RLS + the migration guard. Backfill any real rows (the
  service is mock-first, so data volume is minimal); dual-write briefly if needed.
- **P3 — Confirm stocks/invest parity (homes already exist).** `internal/invest` already
  provides the ledger-integrated stocks surface with `MarketDataAdapter`/`BrokerAdapter`
  ports (the audit's "provider abstraction"), so this is a *diff* of the standalone
  `internal/stocks` against `internal/invest` — fold any missing asset data / broker
  features, then mark the standalone stocks island for removal. Wire real venues
  (Quidax×Alpaca) behind the existing ports.
- **P4 — Ops uplift.** Migrate the observability stack (metrics/tracing/health), the
  admin plane, and the compliance gate into the main backend; adopt the distroless
  image for the main `server` too.
- **P5 — Client cutover.** Point the mobile crypto/stocks/invest UIs (the "three
  overlapping trading UIs") at the consolidated endpoints; collapse to one surface.
- **P6 — Decommission.** Remove `mobile-app/reactnative/backend/` and its Postgres;
  drop `crypto-backend-ci.yml`; update `docs/audit/*` and the deployment doc.

## Consequences

**Positive**
- Trading money flows through the double-entry ledger of record — the integrity gap
  closes; one reconciliation surface, one audit trail.
- One module → simpler dependency graph, one CI story, one deploy story; the main
  backend gains observability + admin + compliance it currently lacks.
- One DB → transactional consistency between positions and wallet balances; one
  migration tool + guard; no cross-DB saga for basic buy/sell.
- Still able to scale trading out later as a separate *binary* without re-splitting.

**Negative / cost**
- P1 is real money-path work: every trade must be re-expressed as balanced postings
  (the standalone's model is prototype-grade). This is the point, but it is not free.
- Reconciling two crypto impls + a third stocks island requires care (pick canonical,
  migrate data, avoid losing positions).
- Two migration systems must be unified; golang-migrate `.down.sql` reversibility is
  dropped in favor of the additive-only convention.
- Temporary dual-write / flag complexity during P2–P5.

**Risks / mitigations**
- *Money bug during ledger integration* → strangler-fig behind a flag, invariant tests
  first, mandatory ledger-auditor review at P1 (as with every money path).
- *Losing the good ops assets* → P4 explicitly migrates them; do not delete before port.
- *Scope creep into provider work* → P3 introduces the port but does not require a live
  provider; Noop/mock adapters remain valid until a real broker/custodian is wired.

## Alternatives considered

- **Keep two modules / go microservices.** Rejected for now: no scale pressure justifies
  it, and separate services would force the money-integrity fix to become a distributed
  saga (harder, not easier). Premature decomposition of a system one team is still
  shaping.
- **Two modules but share a `contracts`/`ledger-client` package.** Reduces duplication
  but still leaves trading money outside the ledger unless the trading service calls
  back into the money core synchronously — at which point the module split buys nothing.
- **Consolidate code but keep two DBs.** Rejected: the ledger must be the single source
  of truth; a second money DB re-introduces the reconciliation gap this ADR exists to
  close. (A separate **schema** — or a read replica — within the same store is fine and
  is the escape hatch for future regulatory segregation.)

## When a future split *is* legitimate (non-goals of this ADR)

Split for a real reason, not by accident:
- **Genuine scale divergence** — high-frequency market-data ingest / order-matching that
  must scale independently of the wallet API → extract a *service* (ideally still one
  module, or a shared `contracts` package), keeping money in the ledger via an
  outbox/event stream.
- **Regulatory segregation** of securities data → a separate **schema or DB behind the
  same service**, not a separate module.

This ADR does not mandate a live trading provider, does not touch the payments/wallet
money model, and does not remove the standalone service until P6.
