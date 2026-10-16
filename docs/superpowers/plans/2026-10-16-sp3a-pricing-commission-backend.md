# SP-3a: Pricing, Platform Fee, Commission, Ledger, Recon & Treasury (Backend) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`). **Money-path, financial system:** tests first; additive-only migrations; request `ledger-auditor` review before marking any money task done and `security-reviewer` before merge; feature-flag; PRs < 400 lines where possible; ADR for the non-obvious choices.

**Goal:** The backend that earns and accounts for Spotlight Global money — a configurable Platform Fee + the FX spread (single source of truth), recognised in the ledger in native currency with an NGN roll-up to the `commission` registry, reconciled three ways, and NGN-treasury monitored. Dark behind `FEATURE_SPOTLIGHT_GLOBAL` / `FEATURE_FX_ORCHESTRATION_ENABLED`.

**Architecture:** New `internal/crossborder/{pricing,fees,revenue,recon,treasury}` packages + extensions to `internal/finance/ledger` (new `AccountType`s + CHECK-widening migration) and `internal/finance/commission` (native-ccy meta). FX spread is expressed once as Verto `fxMarkupPerc` (receivable, accrued in the orch book); the Platform Fee is charged in our ledger at execution. Admin-facing endpoints land here; the console UI is SP-3b.

**Tech Stack:** Go 1.27/Gin; pgx; Postgres via Supabase (additive migration); reuse `finance/ledger`, `finance/commission`, `orchestration` spread engine + `orch_ledger_entries`, `tiers`.

**Spec:** [`docs/superpowers/specs/2026-10-16-sp3-pricing-platform-fee-commission-design.md`](../specs/2026-10-16-sp3-pricing-platform-fee-commission-design.md) · Program: [`2026-10-16-vertofx-spotlight-global-program.md`](2026-10-16-vertofx-spotlight-global-program.md)

## Global Constraints
- **Money = int64 minor units; never float.** Every money mutation requires an idempotency key, posts balanced double-entry, is reversible via reversals only. No bare balance writes.
- **No transactional outbox** — match the repo: in-tx atomicity + idempotency keys + PENDING-row/poll reconcilers.
- **Single source of truth for the FX spread (D1):** the spread (`fx_markup_rates`) is passed ONCE as Verto `fxMarkupPerc`; the vertofx adapter's separate `ProviderFee` markup is **0**; the orch `paymax_spread` book is the accrual record, not a second charge.
- **Native-currency revenue (D3):** record each revenue line in its original currency; post an NGN-converted roll-up (rate + source ccy in `Meta`) to `commission.RecordExact`.
- **Fail-closed pricing:** reject a rule pricing below `verto_cost + floor_margin`; hard cap on total (fee+spread)/txn; maker-checker + effective dating; immutable `Quote` snapshot.
- **Additive-only migration:** new `AccountType` CHECK widening + new tables only; unique 14-digit stamp; re-check at merge.
- Flag off → no fee charged, no new routes mounted, no regression to SP-1/SP-2 or existing FX.

## Review Focus
- **Double-charge / stacking:** a VertoFX convert must apply the spread exactly once (as `fxMarkupPerc`), never also as an adapter ProviderFee or a second `paymax_spread` charge. → Task 8 golden test.
- **Idempotent revenue posting:** a retried/redelivered execution must not double-post commission or double-charge the fee (keys `cb:{transfer_id}:{component}:{service}`). → Task 4/5 tests.
- **Reversal completeness:** a failed/refunded transfer must reverse BOTH the platform fee and the accrued spread, atomically. → Task 4 test.
- **Guardrail fail-closed:** a fee+spread rule below cost+floor, or above the hard cap, must be rejected at config time AND not silently applied at quote time. → Task 2 test.
- **Currency rounding:** receive rounds down, pay rounds up, at the currency minor unit; gross-up formulas exact; no float. → Task 2 property test.

---

### Task 1: New ledger AccountTypes + additive CHECK-widening migration
**Files:** Modify `backend/internal/finance/ledger/service.go` (AccountType enum) + a new `supabase/migrations/<ts>_crossborder_revenue_accounts.sql`; Test: `ledger` account-type test + the live-DB apply.
**Interfaces — Produces:** constants `AccountRevenuePlatformFee`, `AccountRevenueFxMarkup`, `AccountReceivableVertoMarkup`, `AccountFeesUnswept`, `AccountExpenseProviderFees`, `AccountTaxPayableVat`, `AccountSuspenseUnmatchedInbound` (+ `reserve:fund_later_risk` reserved for P3), matching the spec §6 naming.
- [ ] Step 1: failing test asserting each new `AccountType` is accepted by `GetOrCreateStandingAccount` (and rejected before the migration). Step 2: run → FAIL. Step 3: add the Go constants + the additive migration widening the `ledger_accounts` type CHECK (follow the crypto/trading-account precedent migration; `ls supabase/migrations/ | tail` then pick a unique higher 14-digit stamp). Step 4: `go build/vet` + live-DB apply (or skip w/o `TEST_DATABASE_URL`) → PASS. Step 5: commit.

### Task 2: Pricing model + resolver + rounding + guardrails
**Files:** Create `backend/internal/crossborder/pricing/{model.go,resolver.go,rounding.go}` + tests.
**Interfaces — Produces:** `FeeRule`/`FeeSchedule` (spec §7 fields), `QuoteLine{Kind,Service,Amount Money,Payer,RuleID,Visible}`, immutable `Quote`; `Resolve(ctx, in PricingInput) (Decision, error)` (most-specific-wins); `rounding` helpers (receive-down/pay-up, currency minor-unit); guardrails `floorMargin`/`hardCap` fail-closed.
- [ ] Failing tests: `TestResolve_MostSpecificWins`, `TestGuardrail_RejectsBelowCostFloor`, `TestGuardrail_RejectsAboveHardCap`, `TestRounding_ReceiveDownPayUp` (property), `TestGrossUp_TargetAmount` (property). → RED → implement (int64 only) → GREEN → commit.

### Task 3: FeeCollector strategies + fees_unswept accounting
**Files:** Create `backend/internal/crossborder/fees/collector.go` + tests.
**Interfaces — Consumes:** ledger posting API, pricing `Quote` (Task 2), new AccountTypes (Task 1). **Produces:** `FeeCollector` interface + `LedgerChargeCollector` (strategy A: debit user wallet / credit `revenue:platform_fee`, track `fees_unswept`), `NGNWalletCollector` (B), `SpreadBakedCollector` (C); idempotent by `cb:{transfer_id}:platform_fee:{service}`.
- [ ] Failing tests: strategy A charges once + records fees_unswept; idempotent retry; B/C variants; fail-closed when the wallet can't cover. → RED → implement → GREEN → commit. **Request `ledger-auditor` review.**

### Task 4: Multi-currency revenue recognition + commission wiring + reversal
**Files:** Create `backend/internal/crossborder/revenue/{ledger.go,recognition.go}` + tests; Modify `internal/orchestration` execute path + the SP-2 onboarding fee path to call it; Modify `internal/finance/commission` call sites (meta only).
**Interfaces — Consumes:** `commission.RecordExact`, orch `paymax_spread`/`provider_clearing`, `receivable:verto_markup` (Task 1), FeeCollector (Task 3). **Produces:** `RecognizeFXSpread(ctx, trade)`/`RecognizePlatformFee(ctx, charge)` (native line + NGN roll-up to `commission.RecordExact` with original ccy+rate in Meta, idempotent); `MarkSettled(ref, settlement)`; `Reverse(ctx, transferID, reason)` (reverses fee + accrued spread atomically).
- [ ] Failing tests: spread recognised native + NGN roll-up once (idempotent on redelivery); platform fee recognised; accrued→settled transition; **reversal reverses both components** on refund; orch FX now posts to commission (it didn't before). → RED → implement → GREEN → commit. **Request `ledger-auditor` review.**

### Task 5: Daily fee sweep job (flag-gated on V5/V18)
**Files:** Create `backend/internal/crossborder/fees/sweep.go` + tests.
**Interfaces — Consumes:** vertofx wallet-to-wallet (SP-1/SP-2 client), `fees_unswept` ledger. **Produces:** `SweepFees(ctx)` moving accumulated fees sub-account→master, idempotent, marking commission rows SETTLED; gated behind a `FEATURE_VERTO_FEE_SWEEP` flag (default off until V5/V18).
- [ ] Failing tests: sweeps unswept once (idempotent), marks settled, no-op when flag off / nothing unswept, partial-failure continues. → RED → implement → GREEN → commit.

### Task 6: Three-way reconciliation jobs
**Files:** Create `backend/internal/crossborder/recon/recon.go` + `<ts>_crossborder_recon.sql` (recon_runs/recon_breaks) + tests.
**Interfaces — Produces:** `ReconLedgerVsProvider`, `ReconTransfersVsProvider`, `ReconMarkupVsStatement`, `ReconCommissionVsLedger`; break records with type/severity/refs.
- [ ] Failing tests: each check detects an injected break (missing-in-provider, amount mismatch, status mismatch, duplicate) and records it; clean state → no breaks. → RED → implement (+ additive migration, unique stamp) → GREEN → commit.

### Task 7: Treasury monitoring
**Files:** Create `backend/internal/crossborder/treasury/treasury.go` + tests.
**Interfaces — Produces:** `MasterBalances(ctx)`, `LowBalanceAlerts(ctx, thresholds)`, `UnsweptFeesByAccount(ctx)`, pre-funding forecast (NGN focus per D7).
- [ ] Failing tests: low-balance alert fires below threshold; unswept-fees roll-up; forecast arithmetic (int64). → RED → implement → GREEN → commit.

### Task 8: Remove adapter ProviderFee stacking + markup golden test (resolves SP-1 D1)
**Files:** Modify `backend/internal/orchestration/adapters/vertofx.go` (ProviderFee→0 for Verto; spread only via `fxMarkup`); Test: golden pricing-decomposition test.
- [ ] Failing test: a VertoFX convert quote applies the spread exactly once (as `fxMarkupPerc`), with NO separate ProviderFee line and NO second `paymax_spread` charge; the displayed `fxMarkupPerc` equals what's passed to Verto; pin the verified markup sign/unit. → RED → implement → GREEN → commit. **Request `ledger-auditor` review.**

### Task 9: Real admin backend endpoints (API the console consumes)
**Files:** Modify `backend/internal/app/finance_routes.go` + handlers; Test: handler authz tests.
**Interfaces — Produces:** `RequirePermission`-gated endpoints replacing `fxAdminService` mocks: rate-card CRUD, Platform-Fee schedule CRUD (maker-checker, effective-dated), spread-rule sync to `/fx/markup/config`, pricing simulator (calls the SAME `pricing.Resolve`), fee-collection settings, refund-fee policy, profit/recon/treasury reads.
- [ ] Failing tests: each endpoint enforces its permission (e.g. `finance.admin.fx_markup`/a new `finance.admin.pricing`); the simulator returns the same decomposition the production quote engine would; maker-checker blocks self-approval. → RED → implement → GREEN → commit. **Request `security-reviewer`.**

---
## Done when
Fees+spread resolve with fail-closed guardrails; FeeCollector charges in-ledger at execution (sweep flag-gated, fallback otherwise); FX spread + fees post native + NGN-roll-up to `commission` (idempotent, reversible, accrued→settled); new AccountTypes + additive migrations (stamps re-checked); 3-way recon + NGN treasury run; real permissioned admin endpoints exist for SP-3b; money invariants + `ledger-auditor` green; dark behind the flags; `ADR-PR<pr#>-crossborder-pricing-commission.md` records D1 + D3.

## Deliberately NOT here
The admin console UI (SP-3b); mobile fee UX (SP-4); ambassador revenue share / fund-later risk reserve (P3); held-rate (P3).
