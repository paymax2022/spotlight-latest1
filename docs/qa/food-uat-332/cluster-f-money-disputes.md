# Cluster F — Cancellation, Refunds, Disputes, Wallets/Payouts & Commission (RST-UAT-0219 .. 0252)

Run date: 2026-10-20. Spec: `mobile-app/reactnative/tests/e2e/food-uat/cluster-f-money-disputes.spec.ts`
(`npx playwright test tests/e2e/food-uat/cluster-f-money-disputes.spec.ts --project=mobile-chrome --workers=1`).

**Method.** Real HTTP against the Go backend (`:8080`) with real GoTrue JWTs for throw-away users (customer / owner / rider / stranger) and the
`admin@spotlight.internal` fixture (restored with `scripts/dev/ensure-dev-login.sh`, documented password). Fixtures are seeded in local PG (`:54322`):
restaurants, menu item, KYC tier, and wallet funding as a balanced `paymax_revenue -> wallet` journal (same shape as the Go live-DB tests). Money is asserted
at the **ledger** (wallet projection, `ledger_entries` counts per idempotency key, signed residual per order/dispute/withdrawal), never from a 200 alone.
Orders are placed, cancelled, delivered (real `/handoff` settle) and disputed through the live endpoints.

**Result: 44 tests, 43 pass, 1 fail** (the fail is the intentional proof of defect F-001). Case-level (34 workbook cases, 0219-0252) below.

Totals (34 workbook cases): **Pass 22 · Fail 1 (0229, feature gap) · Deferred 7 (flag OFF: 0225/0226/0228/0239-0242) · N/A 4 (0231/0232/0235/0249)**. No money divergence found; no Blocker.

Supplementary: `TEST_DATABASE_URL=… go test ./internal/restaurant -run 'TestRequestWithdrawal|TestMarkWithdrawal|TestAdminListWithdrawals|TestLiveDB_Payout|TestLiveDB_ProcessRun|TestLiveDB_Dispute'` → 22/22 PASS
(withdrawal reserve/insufficient/idempotent/paid/failed/flag-off; payout run + FOOD-009 exclusion; dispute caps, concurrency, tip clawback). Used as the evidence for the
withdrawal cases the live stack cannot exercise because the feature flag is OFF.

## Accepted exceptions applied (not re-raised)
- **FOOD-006** (no customer-facing withdrawal UI): 0239, 0240 — UI portion N/A; admin surface (`/admin/restaurant/withdrawals`, `restaurant.admin.withdrawals`) exercised and works (0243/0244).
- **FOOD-007** (live disburser leaves recipient bank fields empty): 0240, 0243 — latent until a live provider is wired; `NoopDisburser` executes nothing, funds stay `processing` (matches design).

## Environment facts that shape statuses
- `FEATURE_RESTAURANT_WITHDRAWALS_ENABLED` is **not set** in `new-api-1` -> `POST /api/finance/restaurant/withdrawals` returns 403 `ErrWithdrawalsDisabled` (fail-closed, zero ledger effect — asserted). Admin mark-paid/failed are mounted regardless and were exercised on seeded `processing` rows.
- `FEATURE_RESTAURANT_PAYSTACK_CHECKOUT_ENABLED` is **not set** -> no gateway-funded checkout/refund rail is mounted (`finance_routes.go` ~L1789); only wallet-funded orders exist locally.
- Commission split is the compile-time constant 80/10/10 (`restaurant/service.go:32-34`); `CommissionRecorder` only records profit, never moves money.

## Results

| ID | Title | Pri | Core/Cond | Scope | Status | Evidence | Defect |
|---|---|---|---|---|---|---|---|
| RST-UAT-0219 | Cancel before restaurant acceptance | P0 | Core | In Scope | **Pass** | Paid order cancelled by customer (and replayed): order `cancelled`, settlement `refunded`, wallet restored to the kobo, per-order signed ledger residual 0. Stock release is a Cluster-B concern, not asserted here. | — |
| RST-UAT-0220 | Reject cancellation after cutoff | P0 | Core | In Scope | **Pass** | `picked_up` order: customer DELETE -> 4xx, status unchanged, balance unchanged; stranger -> 403. "Support escalation offered" is not a backend concern; post-delivery recourse = dispute rail (0230). | — |
| RST-UAT-0221 | Merchant cancels unavailable meal | P0 | Core | In Scope | **Pass** | Owner DELETE -> 200, customer refunded in full, order `cancelled`. Customer notification is best-effort `s.notify` (no queryable table locally) — not independently asserted. | — |
| RST-UAT-0222 | Process successful full refund | P0 | Core | In Scope | **Pass** (wallet rail) | Admin `POST /api/finance/admin/disputes/:id/resolve {refunded}` on delivered order: customer +total exactly; exactly 2 ledger rows `dispute-refund:<id>:*` (balanced pair); `restaurant_dispute_refunds.refund_kobo = total`; ticket `resolved`. Gateway refund reference = N/A (no gateway rail; see 0225). | — |
| RST-UAT-0223 | Item-level partial refund | P0 | Boundary | In Scope | **Pass** | `refund_partial` of total+1, total, 10x, 0, -5 -> 422 and zero ledger rows; a valid one-item amount credits exactly that amount. Fee-derivation is an admin-keyed amount (no per-line fee calculator). | — |
| RST-UAT-0224 | Prevent duplicate refund creation | P0 | Concurrency | In Scope | **Pass** | 4 concurrent resolves of one dispute: customer credited once (= total), 2 ledger rows, 1 `restaurant_dispute_refunds` row. A second dispute on the same fully refunded order -> 422, no extra money; cumulative per-order refund <= total. | — |
| RST-UAT-0225 | Refund webhook delay (pending -> success) | P0 | Core | **Conditional — Deferred** | Deferred | Gateway refund rail flag OFF; paystack-funded route returns 404. Wallet refunds are synchronous (no pending stage to render). | — |
| RST-UAT-0226 | Failed refund transaction | P0 | Core | **Conditional — Deferred** | Deferred | No gateway refund locally. Fail-closed behaviour proven on the ledger rail: rejected over-cap refund leaves 0 ledger rows, ticket stays `open` (no false "refund paid"), retry succeeds with a single pair. | — |
| RST-UAT-0227 | Recalculate earnings after refund | P0 | Core | In Scope | **Pass** (by policy) | Tipped delivered order, `refund_full`: platform refund = total − tip; tip clawed from rider (−tip), customer made whole (+total), restaurant wallet unchanged and non-negative, residual 0. Policy: platform-funded, no restaurant clawback (ADR-031). | — |
| RST-UAT-0228 | Avoid auto double refund on payment race | P0 | Concurrency | Conditional — Deferred (late-payment race) | Deferred | Paystack-funded checkout OFF. Wallet rail: 5 racing cancels on one order -> one refund, balance restored once. | — |
| RST-UAT-0229 | Enforce refund approval limits | P0 | Security | In Scope | **Fail** (gap) | Role gate Pass: no token 401; customer/owner/rider/stranger 403 on BOTH resolve routes, zero ledger rows, ticket stays `open`. Gap: authorisation is binary (`restaurant.admin.disputes`); there is no value-tiered "over cap needs finance/admin" approval workflow. | **F-002** |
| RST-UAT-0230 | Create order-linked complaint | P0 | Core | In Scope | **Pass** | Customer `POST /orders/:id/dispute` -> 201, row `reference=order, module_type=food, status=open`; duplicate active dispute 422; stranger 403; unknown type 422; undelivered order 422. Evidence attach not supported (`evidence_urls` stays empty) and no mobile UI exists. | F-005b, F-008 |
| RST-UAT-0231 | Restaurant contests complaint | P1 | Core | **Not Applicable** | N/A | No restaurant response route (4 candidate paths all 404; only `POST /orders/:id/dispute` and `GET /disputes/:id` exist — `finance_routes.go` L1842-1845). | F-005 |
| RST-UAT-0232 | Rider reports unsafe dropoff | P0 | Core | **Not Applicable** | N/A | No rider incident route (4 candidates 404). Dispute route refuses a rider on an active job (422) and never alters order state (`picked_up` stays). | F-006 |
| RST-UAT-0233 | Apply approved dispute refund | P0 | Core | In Scope | **Pass** (+gap) | Resolve moves money (+total), response carries `refund_kobo`, re-resolve of a closed ticket 422, party `GET /disputes/:id` returns `resolved` + refund. Only the customer is notified (`disputes_service.go` notify at end); merchant/rider are not. Admin queue route `GET /api/restaurant/admin/disputes` = **500** (see F-001; console uses generic `GET /api/finance/disputes`). | **F-001**, F-009 |
| RST-UAT-0234 | Prevent other customers viewing tickets | P0 | Core | In Scope | **Pass** | Other customer and stranger GET another's ticket -> 403 with no order id in body; random id -> 422; ops queue 403 (customer) / 401 (anon). Static note F-010. | F-010 (static) |
| RST-UAT-0235 | Escalate overdue case | P1 | Core | **Not Applicable** | N/A | `disputes` has no sla/escalated/due column; ticket aged 30 days stays `open` (nothing escalates, nothing silently closes); escalate/overdue routes 404. | F-007 |
| RST-UAT-0236 | Accrue merchant earnings | P0 | Core | In Scope | **Pass** | Delivered order: settlement `settled`, total = escrow, owner wallet +`provider_kobo`; `GET /restaurant/earnings` 200. | — |
| RST-UAT-0237 | Accrue rider earning | P0 | Core | In Scope | **Pass** | Exactly one `settle:*:rider:credit` entry for the order, amount = 10% base + 100% tip; handoff replay posts nothing new. | — |
| RST-UAT-0238 | Available vs pending balance | P0 | Core | In Scope | **Pass** (partial) | Escrowed order: owner wallet unchanged, settlement `escrowed`; earnings payload exposes a `pending` figure. No separate "held" bucket exists. | — |
| RST-UAT-0239 | Request eligible merchant withdrawal | P0 | Core | Conditional — Deferred (flag OFF); UI N/A (FOOD-006) | Deferred | Live: 403 "disabled", wallet unchanged; missing Idempotency-Key 400. Go live-DB `TestRequestWithdrawal_ReservesBalancedLegAndDebitsWallet` PASS. | FOOD-006 |
| RST-UAT-0240 | Request eligible rider withdrawal | P0 | Core | Conditional — Deferred; UI N/A (FOOD-006); disburser (FOOD-007) | Deferred | Live: 403, balance unchanged; rider cannot target the owner's bank account (403/404). | FOOD-006/007 |
| RST-UAT-0241 | Reject withdrawal beyond balance | P0 | Boundary | Conditional — Deferred (flag fronts the check) | Deferred | Live: 999,999,999,999 / 0 / −100 all refused (4xx), no ledger or `restaurant_withdrawals` row. Balance rule: Go `TestRequestWithdrawal_InsufficientFundsRefusesAndMovesNothing` PASS. | — |
| RST-UAT-0242 | Prevent payout double spend | P0 | Concurrency | Conditional — Deferred | Deferred | Live: 6 concurrent requests -> 0 reservations, balance non-negative. Idempotent replay: Go `TestRequestWithdrawal_IdempotentReplayIsSafeNoOp` PASS. | — |
| RST-UAT-0243 | Confirm payout via provider callback | P0 | Core | In Scope (admin path) | **Pass** | Seeded `processing` withdrawal: customer token 403; admin `/paid` twice -> row `paid` once with provider ref saved, exactly one DR suspense/CR clearing pair, wallet not refunded; `/failed` afterwards 409, no reversal rows; residual 0. | — |
| RST-UAT-0244 | Payout failure and reversal | P0 | Resilience | In Scope | **Pass** | `/failed` twice -> wallet restored once (+amount), row `reversed` with reason, one reversal pair, `/paid` afterwards 409; residual 0. | — |
| RST-UAT-0245 | Reject changed bank details on pending payout | P0 | Security | In Scope | **Pass** | No bank-account PUT/PATCH-edit route (404); DELETE of the account in flight -> 403; withdrawal row keeps its original `bank_account_id`. | — |
| RST-UAT-0246 | Reconcile ledger to bank and gateway | P0 | Core | Internal: In Scope / External: N/A | **Pass** (internal) / N/A (external) | Every ledger entry the suite caused nets to 0; 6,632 food-family entries (`settle:`, `dispute-refund:`, `rwithdraw:`, `order:`, `rpayout`) net to exactly 0. No provider-statement import/matching (reconcile routes 404). | F-011 |
| RST-UAT-0247 | Apply platform merchant commission | P0 | Core | Default rule In Scope; tier-specific **N/A** | **Pass** (80/10/10) / N/A (tiers) | provider + platform + rider = total; platform = floor(10% of base). No commission column/plan per tier/zone/effective date. | F-003 |
| RST-UAT-0248 | Apply rider delivery fee split | P0 | Core | In Scope | **Pass** | qty 3 + tip: customer debit = total; rider = floor(10% × (total−tip)) + tip; provider+platform+rider = total. | — |
| RST-UAT-0249 | Freeze historical settlement rule | P0 | Boundary | **Not Applicable** | N/A | Rules are constants; commission-plan write routes 404; a settled settlement row is immutable (unchanged on re-read). | F-003 |
| RST-UAT-0250 | Reverse fee splits on full cancellation | P0 | Core | In Scope | **Pass** | Cancel (with tip): customer whole, owner/rider wallets unchanged, zero `settle:*` entries for the order, residual 0. | — |
| RST-UAT-0251 | Block merchant fee tampering | P0 | Security | In Scope | **Pass** | Order body with forged `total_kobo/fee/platform_pct/provider_kobo/...` -> total identical to honest order; settlement platform fee still floor(10%); owner token 403 on payout build/process. | — |
| RST-UAT-0252 | Rounding and sum conservation | P0 | Boundary | In Scope | **Pass** | Price 33,333 kobo, qty 1/3/7, odd tips: legs are integers and provider+platform+rider = total exactly; residual 0 for each. | — |

## Money-path invariants (HTTP + SQL) — prior-fix regression guards
| Invariant | Spec test | Status |
|---|---|---|
| (1) FOOD-004 admin dispute resolve moves real money | INV-1: 200 + 2 ledger rows + customer +200,000 kobo + ticket resolved | **Pass** |
| (2) FOOD-008 resolve routes gated by `restaurant.admin.disputes` | INV-2: 401 anon, 403 customer on both routes; admin passes the gate (404/422 on ghost id); payouts/withdrawals/disputes admin lists 403 for customers | **Pass** |
| (3) FOOD-009 payout batch excludes already-settled orders | INV-3: delivered order already has `settle:<id>:provider:credit`; BuildRun adds 0 lines, net 0, ProcessRun refuses, owner balance unchanged | **Pass** |
| (4) KYB-approved gating | INV-4: unpaid `settled` settlement for a `submitted`-KYB outlet -> 0 payout lines; same for `approved` -> 1 line; owner cannot self-open a non-approved store (FOOD-010). Withdrawal path itself carries no KYB predicate — see F-004 | **Pass** (payout/open) / see F-004 |
| (5) ADR-040 ledger conserves | INV-5: everything this suite caused nets to 0; all food families net 0; global `ledger_conservation_check` residual was −192,797,418 before and after (unchanged) — contributed by other modules' single-leg seeds (`uat-pharm-fund-*`, `lab/pharm/vet-disp-fund-*`, `fx`, `admtx*`), not food | **Pass** (food) / note below |

## Defects (drafts; orchestrator rolls up)

### FOOD-UAT-F-001 — Major — Dedicated admin dispute queue returns 500 on every call
- **Repro:** `GET /api/restaurant/admin/disputes?limit=5` with `admin@spotlight.internal` bearer.
- **Actual:** 500 `{"error":"internal server error"}`; backend log `ERROR: operator does not exist: text = uuid (SQLSTATE 42883)`.
- **Cause:** `AdminListFoodDisputes` (`backend/internal/restaurant/disputes_service.go` ~L452) does `LEFT JOIN restaurant_dispute_refunds r ON r.dispute_id = d.id`; `restaurant_dispute_refunds.dispute_id` is `TEXT` (`supabase/migrations/20261019000000_restaurant_disputes.sql:14`) and `disputes.id` is `UUID`. Reproducible directly: `select 1 from disputes d left join restaurant_dispute_refunds r on r.dispute_id=d.id` fails identically.
- **Impact:** the purpose-built ops queue (incl. refund exposure per dispute) is unusable. Money paths are unaffected (resolve uses `$1` text params). The console page `/admin/restaurant/disputes` currently reads the generic `GET /api/finance/disputes`, so it is not visibly broken today — but any move to the dedicated route fails. Fix hint: `r.dispute_id = d.id::text`.
- **Spec:** `RST-UAT-0233 (UI) — admin dispute queue endpoint …` (the one red test).

### FOOD-UAT-F-002 — Major (feature gap) — No value-tiered refund approval limit (RST-UAT-0229)
Resolution rights are a single permission; any holder can refund up to the full remaining budget. No "over cap needs finance approval" workflow or dual control. Role gate itself is sound (INV-2).

### FOOD-UAT-F-003 — Major (feature gap) — Commission engine for food is a hard-coded 80/10/10 (0247, 0249)
`restaurant/service.go:32-34`. No merchant-tier, zone or effective-dated rules, no plan editor, so "tier-specific commission" and "freeze historical rule" cannot be tested. Settlement rows do persist the realised split (immutable), which is the only freezing that exists.

### FOOD-UAT-F-004 — Major (to triage) — Withdrawal path has no KYB predicate
`withdrawal.go` contains no `kyb_status` check (only `payout.go` `BuildRun` and `SetAvailability` do). Because direct-at-delivery settlement credits the owner wallet and `RequestWithdrawal` only checks tier + balance, an outlet whose KYB is later revoked/rejected can still withdraw funds already in its wallet once the flag is enabled. Prior invariant (4) "withdrawals require KYB-approved" is therefore satisfied only at the payout-run and store-open layers. Not exercised live (flag OFF); static finding. Decide whether the invariant should be enforced in `RequestWithdrawal` before the flag is turned on.

### FOOD-UAT-F-005 / 005b — Major (feature gap) — No restaurant response to a dispute; no evidence attachment (0231, 0230)
Only `POST /orders/:id/dispute` and `GET /disputes/:id` exist. `RaiseFoodDispute` ignores/never accepts evidence (`evidence_urls` always empty).

### FOOD-UAT-F-006 — Major (feature gap) — No rider incident/unsafe-dropoff report (0232)

### FOOD-UAT-F-007 — Minor (feature gap) — No SLA / escalation for overdue disputes (0235)
An open ticket aged 30 days stays `open` with no escalation field, job or route; also never silently closes.

### FOOD-UAT-F-008 — Major (feature gap) — No customer-facing complaint/dispute UI
No `dispute`/`complaint` reference in `mobile-app/reactnative/app/food/*` or `src/features/food/*`; a customer can only file via the API. Cancel UI exists (`orders/[orderId].tsx`, `restaurant/order/[orderId].tsx`) but runs on the fixture layer by default (`EXPO_PUBLIC_FOOD_USE_MOCK`).

### FOOD-UAT-F-009 — Minor — Dispute resolution notifies only the customer
Merchant and rider are not told the final decision (0233 expects all three). Rider receives a separate notice only when a deferred tip clawback later lands.

### FOOD-UAT-F-010 — Minor (static, not reproduced) — `GetFoodDispute` fails open if order lookup errors
`disputes_service.go` `GetFoodDispute`: the party check runs only `if perr == nil && …`; if `orderParties` errors the dispute is returned to any authenticated caller. Reachable only with a dangling `disputes.reference`.

### FOOD-UAT-F-011 — Minor (feature gap) — No external (bank/gateway) reconciliation (0246)
No provider-statement import or matching job for food; internal ledger conservation is clean.

### Observation (not a food defect) — shared dev DB violates global conservation
`ledger_conservation_check.residual_kobo = -192,797,418` (46k entries) from non-food fixtures with single-leg seeds. Unchanged by this suite; food families net 0. Worth a separate cleanup so ADR-040's whole-table assertion is usable locally.

## Notes / residue
- The suite leaves throw-away users (`ruat-f-*@spotlight.test`), orders, disputes, 9 `restaurant_withdrawals` rows and balanced ledger pairs in local DB (no cleanup — ledger is append-only by rule). All balanced.
- `scripts/dev/ensure-dev-login.sh` was run once for `admin@spotlight.internal` (documented password) and the local service key was read from the main checkout's `frontend-web/.env.local` (not committed).
- Rate limit: `/api/auth/login` returned 429 under swarm load; the spec avoids it (GoTrue password grant directly).
