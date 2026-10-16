# SP-3 — Pricing, Platform Fee, Commission Wiring, Ledger Revenue, Reconciliation & Treasury (Design Spec)

| | |
|---|---|
| **Status** | Draft for review (design spec; implementation plan follows via writing-plans) |
| **Date** | 2026-10-16 |
| **Sub-project** | SP-3 of the Spotlight Global program |
| **Depends on** | SP-1 (VertoFX provider + default + `fx_markup_rates`/spread engine) · SP-2 (onboarding + wallets) |
| **Program** | [`../plans/2026-10-16-vertofx-spotlight-global-program.md`](../plans/2026-10-16-vertofx-spotlight-global-program.md) |
| **Scope** | Backend pricing/fee/commission/ledger/recon/treasury **+** the Next.js admin Pricing & Platform-Fee console (SP-5's A3 pulled forward). Mobile fee UX = SP-4. |

---

## 1. Goal

Make Spotlight Global **earn and account for money correctly**: a configurable **Platform Fee** (flat and/or %, customer pays) on every Verto-backed service, plus the **FX spread** markup, each recognised in the ledger in its **original currency**, posted to the existing **commission** registry as an NGN roll-up for reporting, reconciled three ways against Verto, and monitored for treasury (NGN master pre-funding). All dark behind `FEATURE_SPOTLIGHT_GLOBAL` (fees) / the existing `FEATURE_FX_ORCHESTRATION_ENABLED`.

## 2. Resolved decisions

| # | Decision |
|---|---|
| D1 | **Single source of truth for the FX spread** = the `fx_markup_rates` config (ADR-030/032). For a VertoFX trade the spread is passed ONCE as Verto's `fxMarkupPerc` (Verto applies it → revenue is a **receivable**). The vertofx adapter's separate `ProviderFee` markup is set to **0** (removes the SP-1 stacking hazard). The orchestration `paymax_spread` book is the **accrual record** of that receivable, never a second charge. |
| D2 | **Platform Fee** is an independent lever: flat and/or %, min/max, **customer pays** by default, **single schedule** at launch, charged in OUR ledger at execution. Per service × corridor × tier × amount-band, effective-dated, maker-checker. |
| D3 | **Native-currency revenue recognition.** Each revenue line is recorded in its ORIGINAL currency in a multi-currency revenue ledger; an NGN-converted roll-up (rate + source ccy in meta) posts to the central `commission` registry for the existing profit dashboards + variance. |
| D4 | **Fee collection = ledger-charge at execution + daily sweep** (Verto wallet-to-wallet), with **NGN-wallet** or **spread-baked** fallback if Verto's sweep/partner-fee-deduction (V5/V18) isn't approved. `FeeCollector` is a pluggable strategy. |
| D5 | **Full admin console now** — real backend endpoints replacing the mock `fxAdminService`, + the Next.js Pricing & Platform-Fee console on the real `/api/finance/admin/fx/markup` surface. |
| D6 | **Fail-closed pricing:** a rule that would price below `verto_cost + floor_margin` is rejected; a hard cap on total (fee + spread) per transaction; maker-checker + effective dating + instant rollback; the quote is an immutable snapshot of line items. |
| D7 | VAT/levies are tracked as a quote line (`TAX`) excluded from profit; the rate is finance-set config, defaulting to 0 (off) until finance sets it. |

## 3. Repo grounding (facts)

- **Spread engine exists:** `fx_markup_rates` + `orchestration.NewSpreadEngine` (ADR-030/032); the real, permissioned, audited admin surface is `GET/PUT /api/finance/admin/fx/markup` (+audit), `finance.admin.fx_markup`. `orchestration` keeps its own per-currency double-entry book `orch_ledger_entries` with accounts `paymax_spread` + `provider_clearing`, and `splitSpread` apportions source total into retained spread vs clearing.
- **Commission registry:** `internal/finance/commission` — `RecordExact(category, service, subtype, grossKobo, recordedRevenueKobo, sourceModule, sourceRef, userID, idempotencyKey)` posts DR `provider_clearing` → CR `commission` and inserts an immutable `commission_earnings` row; **records realized profit in NGN kobo** (`Earning.Currency` exists but recognition is NGN). Idempotent on `idempotency_key`. **Orchestration FX does NOT post to it yet** (SP-3 wires it).
- **Ledger:** int64 kobo, append-only, closed `AccountType` enum + DB CHECK; posting `Credit/Debit(+Gated)/PostJournal/PostReversal/Posted`; corrections = reversals only. Existing relevant accounts: `paymax_revenue`, `commission`, `fx_spread_income`, `provider_clearing`, `settlement`, `referral_reward_expense`, `expense:provider_fees`-equivalent. **No transactional outbox** anywhere — use in-tx atomicity + idempotency keys + PENDING-row/poll reconcilers.
- **Admin UI:** `frontend-admin/app/admin/fx/*` (15 pages, mostly mock; `fxAdminService.ts` throws `NO_BACKEND_YET`), `app/admin/commission/*` (Rate Card + Profit), shared `vuexy.tsx` + `_ui.tsx` (`money()`/status chips). RBAC = permission strings (`middleware.RequirePermission` backend; `routeGuard.ts`/`hasPermission` frontend) — define roles as permission bundles.
- **SP-2:** onboarding charges service/document fees via the same FeeCollector (this spec); SP-2 left `status.tier` + funding-mode omitted (SP-3 fills via pricing/treasury data).

## 4. The four price layers (collapsed to avoid stacking — D1)

| Layer | Who sets | Who collects | SP-3 treatment |
|---|---|---|---|
| **L0 Verto cost** | Verto rate card | Verto | Loaded into admin Rate Card; used only for the floor-margin guardrail + profit = revenue − cost. Never shown to users. |
| **L1 Platform Fee** | Paymax | **Spotlight ledger, at execution** | Charged via `FeeCollector`; revenue immediate; recognised native-currency + NGN roll-up. |
| **L2 FX spread** | Paymax (`fx_markup_rates`) | **Verto applies, pays us** | Passed ONCE as `fxMarkupPerc`; **receivable**; accrued in `paymax_spread`/a receivable account; settled on Verto statement. **Not** also charged as an adapter ProviderFee (D1). |
| **L3 pass-through/tax** | Verto / govt | Verto / tax authority | Held-rate premium + VAT as net-zero / `tax_payable` lines; excluded from profit. |

```
customer_pays     = amount + L1 platform_fee + L3 passthrough + L3 tax   (L2 baked into the Verto rate)
spotlight_revenue = L1 platform_fee + L2 fx_spread
spotlight_profit  = spotlight_revenue − L0 verto_cost_not_in_rate
```

## 5. Components / module layout

```
backend/internal/crossborder/pricing/     # fee schedule model + resolver + quote line-items + guardrails
  model.go      # FeeSchedule, FeeRule (service×corridor×tier×band, flat/pct_bps/min/max, payer_mode), QuoteLine{Kind,Amount,Currency,Payer,Visible}, immutable Quote snapshot
  resolver.go   # most-specific-wins rule resolution; floor-margin + hard-cap guardrails (fail-closed)
  rounding.go   # one rounding policy (receive rounds down, pay rounds up; currency minor-unit metadata); int64 only
backend/internal/crossborder/fees/
  collector.go  # FeeCollector interface + strategies A(ledger-charge+sweep) / B(NGN wallet) / C(spread-baked)
  sweep.go      # daily fee sweep job (Verto wallet-to-wallet), fees_unswept accounting; flag-gated on V5/V18
backend/internal/crossborder/revenue/
  ledger.go     # multi-currency revenue recognition (native) + NGN roll-up to commission.RecordExact
  recognition.go# accrued→settled lifecycle for fx_spread (receivable) and platform_fee (immediate)
backend/internal/crossborder/recon/
  recon.go      # three-way recon jobs + break records
backend/internal/crossborder/treasury/
  treasury.go   # NGN master balance monitoring, low-balance alerts, pre-funding forecast
backend/internal/finance/ledger/           # EXTEND: new AccountType constants (§6) + CHECK-widening migration
backend/internal/finance/commission/        # wire orchestration FX + onboarding fees in; multi-ccy meta
backend/internal/app/finance_routes.go      # real admin endpoints replacing fxAdminService mocks (behind RequirePermission)
frontend-admin/app/admin/fx/{spread,pricing,...}/   # Pricing & Platform-Fee console on the real endpoints
```

## 6. Ledger accounts (new `AccountType` constants + additive CHECK-widening migration)

Add (Go constant + widen the `ledger_accounts` CHECK, additive-only, per the crypto/trading precedent):
`revenue:platform_fee:{service}`, `revenue:fx_markup` (native accrual), `receivable:verto_markup`, `fees_unswept:{companyId}:{ccy}`, `expense:provider_fees`, `tax_payable:vat`, `reserve:fund_later_risk` (P3), `suspense:unmatched_inbound`.
The multi-currency revenue ledger (D3): either extend `orch_ledger_entries` (already per-currency) with these revenue accounts, or a new `crossborder_revenue_entries` table keyed `(account, currency, amount_minor)`. **Recommendation:** reuse `orch_ledger_entries` for FX-spread native accrual (it already holds `paymax_spread`), add a small `crossborder_revenue_entries` for platform-fee + onboarding-fee native lines; both roll up to `commission` in NGN. No bare balance writes; reversals only.

## 7. Quote & fee resolution

- `BuildQuote(ctx, user, service, corridor, amount, flow) (Quote, error)`: validate user/tier/limits → resolve fee rule (most-specific-wins: per-transfer override > promo > negotiated > plan×corridor×service×band > corridor×service > currency-pair > universal) → resolve spread from `fx_markup_rates` → compute L1/L2/L3 + L0 cost + est. profit → **guardrails (fail-closed)**: reject if `fee+spread < L0 + floor_margin` or `> hard_cap`; sign/round once (§rounding) → freeze immutable `Quote` with line items → persist. Same `fxMarkupPerc` shown == passed to Verto at booking.
- Payer modes: fee-on-top (default send), fee-included (receive), split (marketplace). Target-amount gross-up formulas property-tested.

## 8. Commission wiring (D3 native + NGN roll-up)

- At FX execution: record the spread in `paymax_spread` (native, accrued) + a `receivable:verto_markup` line; at completion, post `commission.RecordExact(category="Finance", service="fx"|"convert"|"send"|..., grossKobo=NGN-converted gross, recordedRevenueKobo=NGN-converted spread, sourceModule="crossborder", sourceRef=transfer_id, idempotencyKey="cb:{transfer_id}:fx_spread")` with the original currency + rate in meta.
- At platform-fee charge: native revenue line + `commission.RecordExact(..., service=..., recordedRevenueKobo=NGN(fee), idempotencyKey="cb:{transfer_id}:platform_fee:{service}")`.
- **Accrued→Settled:** platform fee ACCRUED at execution → SETTLED on sweep/collection; fx_spread ACCRUED at execution → SETTLED on Verto statement; a settlement step marks the commission rows + posts the cash/receivable movement. Reversal on failed/refunded transfers reverses all components (idempotent).
- Taxes excluded from profit (post to `tax_payable:vat`). Ambassador revenue share = an optional rule splitting a % of net to the referrer via the existing referral payee logic (P3).

## 9. Reconciliation (three-way) & treasury

- **Recon jobs** (no outbox; polling + idempotent): ledger vs Verto wallet balances (hourly+EOD); our transfers vs Verto trades/payouts (15-min open / daily all); expected markup (from `fxMarkupPerc`/`PRPreFXMarkupRate`/amounts) vs Verto-reported markup (per statement); commission entries vs ledger revenue accounts (daily). Break types → `crossborder_recon_breaks` with runbook/assignee.
- **Treasury:** NGN master balance monitoring + low-balance alert + pre-funding forecast; fee-sweep monitor (unswept by sub-account, run history, failures).

## 10. Admin console (real, replacing mocks — D5)

- Make the real backend endpoints under `/api/finance/admin/fx/*` (today only `/markup` is real), each `RequirePermission` gated: rate-card editor (L0), **Platform-Fee schedule editor** (service×corridor×plan×tier×band, maker-checker, effective dating), spread rules synced to `/fx/markup/config`, **pricing simulator** (byte-for-byte the production quote engine), margin heatmap, fee-collection settings (strategy A/B/C + sweep schedule), refund-fee policy, commission/profit dashboard (native + NGN, accrued vs settled, variance vs Verto), recon dashboard + break management, treasury view.
- Frontend: extend `fxAdminService.ts` (remove `NO_BACKEND_YET` for the now-real routes), build the console pages on `vuexy.tsx`/`_ui.tsx`; RBAC via permission bundles (Admin/Finance/Compliance/Support/Read-only → permission sets).

## 11. Resolves prior deferrals

- SP-1: fxMarkup bps-vs-percent **unit** confirmed + encoded in a golden test (sandbox V3/V19); the ProviderFee/spread **stacking** removed (D1).
- SP-2: `status.tier` + funding-mode surfaced via pricing/treasury data where relevant.

## 12. Testing strategy (TDD)
Property tests (rounding, gross-up, rule precedence, floor/cap guardrails); golden tests (quote decomposition per corridor incl. the verified Verto markup sign); multi-currency revenue recognition + NGN roll-up idempotency; accrued→settled lifecycle + reversal; recon break detection (injected breaks); fee-sweep idempotency; admin endpoint authz; live-DB tests gated on `TEST_DATABASE_URL`; money invariants (`npm run test:money` style) — no float, int64 minor units, balanced double-entry, idempotency keys on every money mutation; `ledger-auditor` review mandatory before merge.

## 13. Carried gates (confirm before enabling the flag for real money)
V2 markup settlement terms (accrued→settled cash timing); V3/V19 markup sign + which flows carry markup; V4 Paymax rate card (fee/spread numbers + floors); V5/V18 sweep + partner-fee deduction (else fallback B/C); V26 VAT/levy treatment. All build-against-modeled + admin-config placeholders until resolved.

## 14. Done when
Pricing engine resolves fees+spread with fail-closed guardrails; the FeeCollector charges in-ledger at execution (sweep behind the V5/V18 flag, fallback otherwise); FX spread + platform/service fees post native + NGN-roll-up to the commission registry (accrued→settled, idempotent, reversible); new ledger AccountTypes + additive CHECK-widening migration; three-way recon + NGN-treasury monitoring run; the admin Pricing & Platform-Fee console is real and permissioned; all money invariants + `ledger-auditor` green; dark behind the flags; `ADR-PR<pr#>-crossborder-pricing-commission.md` records the single-source-of-truth spread decision (D1) and the native-currency recognition model (D3).
