# E2E QA — Static Journey Traces (Paymax × Spotlight Super App)

**Method:** static code trace only (system not run). Each journey is traced hop-by-hop
from the mobile screen / admin page → feature API client → HTTP route → Go handler →
service → DB table → response back to UI. A hop is **BROKEN** when there is a missing
route, a path/field/shape mismatch, an unenforced guard, a missing DB table, or a
mock-only surface with no live backend. File references are absolute with line numbers.

**Global fact that colours every mobile journey:** every mobile feature module ships
**mock-first** (`USE_MOCK` defaults `true` behind an `EXPO_PUBLIC_*_USE_MOCK` env var). In
the default build the app renders from in-memory fixtures and never touches the backend,
so "the demo works" is not evidence the live path works. Each trace below evaluates the
**live** path (flag flipped to `false`).

---

## Summary matrix

| # | Journey | E2E status (live) | First break | Severity |
|---|---------|-------------------|-------------|----------|
| 7 | Crypto withdrawal → AML approve → ledger; reconcile | **BROKEN — money can leave before AML** | Hop 4a: member withdraw auto-broadcasts; AML queue starved; also **no DB migrations exist** | **CRITICAL** |
| 6 | Restaurant order → dispatch → settle → payout | **Breaks at hop 3** (order placement 400s) | Idempotency-Key read from body not header + `item_id`/`menu_item_id` mismatch | **HIGH** |
| 3 | EdTech promotion two-approval (SF-3) | Backend correct; **admin console wired to non-existent routes**; approval endpoints **not RBAC-gated** | Admin service `/admin/fees/promotions` has no backend route; member routes ungated | **HIGH** |
| 1 | EdTech parent pays school fee | Partially live: pay route exists but **payload mismatch**; guardian list routes missing | `amountKobo/method` vs backend `amountMinor`; no children/invoices-list route | **HIGH** (money) |
| 2 | EdTech vault fund → apply-to-invoice | Backend complete; **client never wires apply-to-invoice**; contribute payload mismatch | Mobile has no `applyToInvoice`; `amountKobo` vs `amountMinor` | **MEDIUM** (money) |
| 8 | Connect discovery | Wiring coherent; **live response shape mismatch crashes UI** | `ProfileCard` omits `photos/age/prompts/id`; `verified` bool vs array | **MEDIUM** |
| 5 | Estate dues + security oversight | Dues works e2e (mock-gated); **estate-admin backend orphaned** (no client) | Admin client points at `/api/v1/estate/admin/*` (mostly no proxy), not the real Go `/api/finance/estate-admin/*` | **MEDIUM** |
| 4 | EdTech minor-safe leaderboard (SF-7) | Serializer correct + fail-closed; **mobile leaderboard mock-only** | `getLeaderboard` has no live route as-shaped (competition-id keyed) | **LOW** (no live PII leak; serializer safe) |

**Works end-to-end today (live) with no code change: none of the 8.** All either break
on a real live-path defect or remain mock-only because the client is not wired to the
existing backend. Compliance/minor-safety logic (SF-3 promotion gate, SF-7 serializer) is
**correct where implemented in the backend**; the gaps are in wiring and guards, not the
core invariants.

---

## Journey 1 — EdTech: Parent pays a school fee

Mobile pay flow → `fees/api.ts` → `POST /api/finance/academy/invoices/:id/payments` →
Go invoice/payment → ledger → `academy_invoice_payments`.

| Step | File | Status | Note |
|------|------|--------|------|
| 1. Pay screen | `mobile-app/reactnative/app/learn/academy/fees/pay/[invoiceId].tsx` | OK | Uses `useInvoice`, `usePayInvoice`; on success reads `res.status`, `res.amountKobo`, `res.newBalanceKobo`. |
| 2. Mock gate | `src/features/academy/fees/constants.ts:23-32` | MOCK DEFAULT | `USE_MOCK` defaults `true`; `ACADEMY_FEES_API_BASE = '/api/finance/academy'`. Live only if env `= 'false'`. |
| 3. API client `payInvoice` | `src/features/academy/fees/api.ts:372-391` | BROKEN (payload) | Live path `POST /invoices/:id/payments` with `Idempotency-Key` header is correct, but body sends `{amountKobo, method}`; backend `RecordPaymentRequest` expects `amountMinor` (+ optional `gatewayRef`/`ledgerReference`). Field names diverge — self-documented at `:382-384`. |
| 3a. Guardian children list | `src/features/academy/fees/api.ts:276-283` | BROKEN (no route) | `getChildren()` live path `/fees/children` does not exist; backend only has school-scoped `GET /schools/:schoolId/students`. |
| 3b. Invoices list | `api.ts:285-294` | BROKEN (no route) | `getInvoices()` `/fees/invoices` list-by-child route does not exist; backend exposes only `GET /invoices/:id` and `GET /students/:studentId/invoices`. |
| 4. Route mount | `backend/internal/app/finance_routes.go:453,464` → `academy_routes.go:212-213,240` | OK | `RegisterAcademy` under `FeatureAcademyEnabled`+pool; fees behind `FeatureAcademyFeesEnabled`. `RegisterFeesInvoice` registers `POST /invoices/:id/payments`. |
| 5. Handler | `backend/internal/academy/fees/invoice/handler.go:142-160` | OK | `RecordPayment` reads `Idempotency-Key` header (`idemKey`, `:44`), binds `RecordPaymentRequest` (`amountMinor`), calls service. Returns `{data}`. |
| 6. Money path | `academy_routes.go:363-378` (`feesPaymentInvoice`), `:336-350` (`feesPaymentLedger`) | OK | Real double-entry: guardian wallet → `AccountSettlement` via `ledger.Debit` (fail-closed on funds), invoice-side `RecordPayment` (SF-2 derived balance, idempotent). |
| 7. DB table | `academy_invoice_payments`, `academy_invoices` | OK | Referenced across `feesPaymentInvoice`/`feesTrustMetrics`; invoice payments append-only (SF-2). |
| 8. Response → UI | `PaymentResult` fields | BROKEN (shape) | Screen reads `newBalanceKobo`/`status`/`amountKobo`; backend `RecordPayment` returns a `RecordPaymentResult` whose shape is not confirmed to carry these exact fields — client would mis-render on live. |

**Verdict:** Mock-only by default; on the live path it **breaks at hop 3** — the payment
POST reaches a real, ledger-correct, idempotent handler, but the request body field names
(`amountKobo`/`method` vs `amountMinor`) and the response field names diverge, and the two
guardian-facing list routes the screen needs to reach the pay screen (children, invoices)
do not exist server-side.

**Fix:** (a) Spec-first in `contracts/openapi.yaml`, then align the client body to
`amountMinor` (and map the response back to `newBalanceKobo`/`status`), or widen the
backend `RecordPaymentRequest`/result to the client's kobo field names. (b) Add
guardian-scoped `GET /academy/fees/children` and `GET /academy/fees/invoices?childId=`
routes (or repoint the client to the school-scoped routes and add a guardian→children
resolver). Keep the `Idempotency-Key` header (already correct).

---

## Journey 2 — EdTech: Guardian funds a vault then applies to invoice

Vault contribute → apply-to-invoice.

| Step | File | Status | Note |
|------|------|--------|------|
| 1. Vault screen | `app/learn/academy/fees/vault/index.tsx` | OK (partial) | Uses `useVaults`, `useFundVault`, `useCreateVault`; only funds. Card shows "Ready for fees" with **no apply action**. |
| 2. `createVault` | `src/features/academy/fees/api.ts:492-508` | OK | Live `POST /vaults` wired. |
| 3. `fundVault` | `api.ts:510-529` | BROKEN (payload) | Live `POST /vaults/:id/contribute` + `Idempotency-Key` correct, but body sends `amountKobo`; backend `ContributeRequest` expects `amountMinor`. |
| 4. **apply-to-invoice (client)** | `api.ts` / `fees/hooks.ts` | **BROKEN (missing)** | No `applyToInvoice`/`applyVaultToInvoice` function or hook anywhere on the client. The backend `POST /vaults/:id/apply-to-invoice` is never called. The one-tap apply hop does not exist in the app. |
| 5. Backend vault routes | `backend/internal/academy/fees/vault/handler.go:86-100` | OK | `contribute`, `apply-to-invoice`, `withdraw`, `lock`, `unlock` all registered; `Idempotency-Key` required on money routes (`:44,158,176`). |
| 6. Vault money path | `academy_routes.go:422-467` (`feesVaultLedger`, `feesVaultInvoice`) | OK | Contribute = guardian wallet → segregated vault standing account (`AccountEdtechFeesVault`) via `ledger.Debit`; apply = `PostJournal` vault → settlement, then invoice `RecordPayment`. Real double-entry, idempotent, fail-closed (only registered when `ledgerSvc != nil`). |
| 7. DB | `academy_fees_vault*` / ledger accounts | OK | Segregated account via `GetOrCreateStandingAccount`. |
| 8. Auto-save | `api.ts:531-548` (`updateAutoSave`) | BROKEN (no route) | `PUT /fees/vaults/:id/auto-save` does not exist; auto-save is a mock-only convenience. |

**Verdict:** Backend vault surface is **complete and ledger-correct**, but the journey
**breaks at hop 4 on the client**: a fully-funded vault cannot be applied to an invoice
from the app (no client function/hook/button), and the contribute payload field name
(`amountKobo` vs `amountMinor`) diverges. Auto-save is mock-only.

**Fix:** Add `applyVaultToInvoice(vaultId, invoiceId, idemKey)` to `api.ts` + a
`useApplyVaultToInvoice` hook + an "Apply to invoice" action on the vault card, targeting
the existing `POST /vaults/:id/apply-to-invoice`. Align contribute body to `amountMinor`.
Either drop the mock auto-save UI or add the backend auto-save-rule endpoint.

---

## Journey 3 — EdTech: Promotion two-approval (SC-35 / SF-3)

Admin promotion console → approve teacher → approve head → apply; a single approval must
NOT apply.

| Step | File | Status | Note |
|------|------|--------|------|
| 1. Admin console | `frontend-admin/app/admin/academy/fees/promotion/page.tsx` | OK (UI logic) | Implements the gate visually: Apply disabled until `status === 'promotion_approved'`; lifecycle `results_finalized → computed → reviewed → approved → applied`. |
| 2. Admin service | `frontend-admin/src/services/academyFeesService.ts:312-338` | BROKEN (no route) | `listPromotions()` → `/admin/fees/promotions`, `approvePromotion()`, `applyPromotion()`. Comments (`:314-316`) state there is **no admin backend route**; promotions are member-only + per-promotion; `adminBase()` cannot reach the `/api/finance/academy` mount. Mock-only for live. |
| 3. Mobile promotion UI | — | N/A (none) | No mobile screen calls teacher/admin-approval/apply. Admin-web only. |
| 4. Backend routes | `backend/internal/academy/fees/promotion/handler.go:90-109` | BROKEN (unguarded) | `teacher-approval`, `admin-approval`, `apply` are registered on the **member** group with **no RBAC**: `_ = admin`, `_ = rbac` (`:106-107`). The handler's own doc-comment (`:80-82`) says the two approval endpoints "must be gated with DISTINCT RBAC permission slugs" — this gating is not done. Any authenticated member can hit either approval. |
| 5. Service (SF-3 core) | `backend/internal/academy/fees/promotion/service.go:182-286` | OK | Two-approval enforced in depth: `TeacherApprove` (computed→reviewed), `AdminApprove` (reviewed→approved) with **distinct-approver guard** (`:218-222`), `Apply` gated structurally by the state machine (`EvAdminApply` legal only from `promotion_approved`) **plus** an explicit assert that both approver columns are set and distinct (`:265-275`). A single approval **cannot** apply (SF-3 holds). |
| 6. Rollover | `promotion/rollover.go:38-90` | OK | Idempotent (set-to-target), moves no money. |
| 7. DB backstop | `academy_promotion_records_two_approvals_check` (cited `service.go:24`) | OK | DB CHECK is the final backstop for two distinct approvals. |

**Verdict:** The **SF-3 invariant itself is correctly and defensively enforced** in the
backend service + state machine + DB CHECK — a single approval cannot apply. But the
journey does not work end-to-end: (a) the admin console is wired to `/admin/fees/...`
routes the backend does not expose (mock-only live), and (b) the real approval/apply
endpoints are mounted on the member group with **no RBAC gating**, so the teacher-vs-head
authz separation exists only in comments. The distinct-approver guard means one *user*
still can't self-approve twice, but any member role can act as either approver.

**Fix:** (a) Add an admin-facing promotion listing/approval surface (or repoint the admin
console to the member routes with an admin auth context). (b) Gate the promotion routes:
wrap `teacher-approval` with `academy.fees.promotion.approve.teacher` and `admin-approval`
with `academy.fees.promotion.approve.head` (distinct slugs), and `apply` with
`academy.fees.promotion.apply`, using the `rbac` already passed into `RegisterFeesPromotion`.

---

## Journey 4 — EdTech: Cross-school competition + minor-safe leaderboard (SF-7)

Mobile student leaderboard → serializer strips PII without consent.

| Step | File | Status | Note |
|------|------|--------|------|
| 1. Leaderboard screen | `app/learn/academy/competition/leaderboard.tsx` | OK | Uses `useLeaderboard(scope)`, `useCompetitionProfile`, `useSetCompetitionConsent`. Renders `displayName` (first-name + school by default); shows `MINOR_SAFE_NOTE` banner + consent toggle. |
| 2. `getLeaderboard` | `src/features/academy/fees/api.ts:655-671` | BROKEN (no route as-shaped) | Live path `/competition/leaderboards/:scope` does not exist; backend leaderboard is competition-id-keyed (`GET /competitions/:id/leaderboard?scope=`) and returns a leaner `{scope, entries}` (no `scopeLabel`/`period`/`myRank`/`minorSafe`). Left mocked. |
| 2a. Client serializer | `api.ts:637-645` | OK (mock mirror) | `serializeEntries` strips `fullName` unless `consentGiven` — mirrors the server rule for the mock. |
| 3. Backend competition routes | `academy_routes.go:284-289` | OK | `feescompetition.Handler.Register(member, admin, guard)` wired; leaderboard read exists. |
| 4. **Server serializer (SF-7 core)** | `backend/internal/academy/fees/competition/serializer.go:75-161` | OK | **Default-strip / fail-closed**: adults full; minors stripped to `{rank, score, first_name, school}` unless a recorded `data_sharing` consent is found. Nil checker / error / false all resolve to STRIPPED. `SerializeFullIdentity` **rejects** (`ErrConsentRequired`) rather than silently returning empty PII. `StudentUserID` never serialized. |
| 5. Consent store | `academy_routes.go:541-560` (`feesConsentChecker`) | OK | Reads immutable `academy_consent_records`; fail-closed on nil pool / lookup error (strip). |
| 6. Consent set from app | `api.ts:757-767` (`setCompetitionConsent`) | BROKEN (no route) | Consent is read server-side from `academy_consent_records`; there is no member endpoint to *set* competition consent from the app. Mock-only. |

**Verdict:** The **SF-7 minor-safe serializer is correct and fail-closed** — no live PII
leak risk in the backend. But the mobile leaderboard is **mock-only**: the scope-keyed
read has no matching live route (backend is competition-id keyed with a leaner shape), and
the guardian-consent toggle has no live write endpoint. So the compliance logic is sound
but unreachable from the app today. Lowest severity precisely because the dangerous
direction (leaking PII) is the one that fails closed.

**Fix:** Add a member leaderboard read that accepts a scope (or resolves scope→competition
id) and returns the richer `CompetitionLeaderboard` shape, and a member consent-write
endpoint that appends to `academy_consent_records`. Until then keep the module mock-flagged.

---

## Journey 5 — Estate: Dues + Security oversight

Mobile estate dues/guard → estate-admin routes → estate tables.

| Step | File | Status | Note |
|------|------|--------|------|
| 1. Estate hub | `mobile-app/reactnative/app/property/estate.tsx:20-36` | OK | Nav-only; routes to `/dues`, `/guard`. |
| 2. Dues client | `src/features/dues/api.ts:15,61-68` | OK (mock-gated) | `USE_MOCK` default `true`. Live: `GET /api/v1/estate/dues`, `POST /api/v1/estate/dues/{id}/pay` + `Idempotency-Key`. |
| 3. Guard screens | `app/guard/log.tsx:13-17` + `src/features/visitor/api/visitor.api.ts` | OK (mock-gated) | Guard consumes the **visitor** feature (`EXPO_PUBLIC_VISITOR_USE_MOCK`); no dedicated guard client. |
| 4. Estate-admin client | `src/features/estateadmin/api.ts:17-27` | BROKEN (self-documented) | Targets `/api/v1/estate/admin/*`; only `/summary` has a Next proxy. `/residents`, `/config`, `/rules`, `/audit-log`, `/run-maintenance` have no proxy — mock-only. **Does not call the real Go `/api/finance/estate-admin/*` surface at all.** |
| 5. Dues pay route | `frontend-web/app/api/v1/estate/dues/[id]/pay/route.ts:9-19` | OK | Rejects missing `Idempotency-Key` (400) before work. |
| 6. Dues money path | `frontend-web/src/server/estate/dues.ts:100-144` | OK | `debit_wallet_atomic` RPC → balanced ledger + tier check fail-closed; upserts `estate_payments` on unique `reference`; no direct balance UPDATE. |
| 7. Go dues service (parallel) | `backend/internal/estate/service_dues.go:124-226` | OK | Fully ledger-correct + idempotent, but **not reached by mobile** (mobile dues goes through the Next.js path). |
| 8. Estate-admin Go routes | `backend/internal/app/estate_admin_routes.go:59-115`; wired `finance_routes.go:1059` | OK | Read-only oversight at `/api/finance/estate-admin`, feature-flagged (`FeatureEstateEnabled`), RBAC-gated per route (`estate.admin.{security,dues,ops,content,election}`), slugs seeded (`20260919000000_estate_admin_rbac.sql`). |
| 9. DB tables | estate migrations (17 tables) | OK | `estate_dues_invoices`, `estate_payments`, `estate_gates`, `guard_shifts`, `gate_incident_reports`, `estate_emergency_alerts`, etc. all present. |

**Verdict:** Resident **dues works end-to-end** (mock-gated; flip flag → real,
ledger-correct, idempotent). Guard/security resident side works (via visitor module). But
the estate-admin **oversight backend is orphaned — it breaks at hop 4**: the backend is
production-ready (registered, flagged, RBAC-gated, tables present) yet **no client is
wired to `/api/finance/estate-admin/*`**; the mobile admin client points at
`/api/v1/estate/admin/*` where only `/summary` exists.

**Fix:** Repoint `estateadmin/api.ts` to `/api/finance/estate-admin/{dues,security,ops,...}`
(the `/api/finance/:path*` rewrite already covers it), update the response mappers to the
Go `{data:[...]}` snake_case shape, and set `EXPO_PUBLIC_ESTATEADMIN_USE_MOCK=false`. The
backend, RBAC seed, and tables are already in place.

---

## Journey 6 — Restaurant/Food: order → dispatch → settle → payout run

| Step | File | Status | Note |
|------|------|--------|------|
| 1. Checkout → placeOrder | `app/food/checkout.tsx:106-118`, `src/features/food/api.ts:154-170` | OK (client) | Payment first, then `placeOrder`; sends `items:[{item_id, qty}]` + `Idempotency-Key` header only. Mock default `true`. |
| 2. Next proxy | `frontend-web/app/api/v1/restaurant/[id]/orders/route.ts:11` | OK | Auth enforced; forwards header to `/api/finance/restaurant/:id/orders`. |
| 3. **PlaceOrder bind** | `backend/internal/restaurant/handler.go:39-52`, `model.go:106-139` | **BROKEN** | (a) Handler never reads the `Idempotency-Key` header; `IdempotencyKey` is bound from JSON **body** with `binding:"required"` — mobile sends it only as a header → `ShouldBindJSON` fails → **400**. (b) `item_id` (mobile) vs `menu_item_id` (backend, required) → 400. |
| 4. Escrow | `restaurant/service.go:171-292` (esp. 230) | OK (if reached) | `settlement.Escrow(...)` real ledger escrow — unreachable because hop 3 400s. |
| 5. Route wiring / flag | `finance_routes.go:1155,1194,1212` | OK | `/api/finance/restaurant`; gated `FeatureRestaurantEnabled`. |
| 6. Ready → auto-dispatch | `finance_routes.go:1213-1230`, `dispatch.go` | OK | Status, dispatch, rider accept/pickup. |
| 7. Handoff → settle | `dispatch.go:138-172`, `service.go:443-460` | OK | `ConfirmHandoff` → delivered → `settleOrder` → 80/10/10 split (90/10 no rider). Real ledger release. |
| 8. Admin payout build | `finance_routes.go:1278`, `payout.go:118-203` | OK (backend) | `POST /api/restaurant/admin/payouts/build`, RBAC `restaurant.admin.payouts`; idempotent draft + append-only lines. |
| 9. Admin payout process | `finance_routes.go:1280`, `payout.go:279-385` | OK (backend) | Requires `Idempotency-Key`; one balanced settlement→provider-wallet transfer; guarded draft→processing→paid. |
| 10. Admin payout UI ↔ backend | `frontend-admin/src/services/restaurantAdminService.ts:270-288` | BROKEN | `getPayoutLines` calls `GET …/payouts/:id/lines` — **no such route** (lines embedded in `GET …/payouts/:id`). `PayoutRun` field shapes diverge (`provider_type`/`*_minor`/`period_key` vs UI `payee_type`/`*_kobo`/`period_start`). **No build-run trigger** in the UI — runs can't be created from the console. Mock default. |
| 11. DB tables | `20260616270000_restaurant.sql`, `20260919000400_restaurant_payouts.sql` | OK | `orders`, `order_items`, `menu_items`, `restaurant_payout_runs/lines`, shared `settlements`. |

**Verdict:** **Breaks at hop 3** on the live path. The backend (escrow, dispatch, settle,
payout build/process) is genuinely implemented and ledger-correct, and routing/flags/DB
are correct — but the mobile→backend order contract is misaligned on two fields, so a
real order returns **400** and never reaches escrow. Everything downstream is sound
server-side but unreachable, and the admin payout UI is mock-default and shape-mismatched.

**Fix:** (1) In `PlaceOrder` read `c.GetHeader("Idempotency-Key")` into `req.IdempotencyKey`
before validation (mirror the other money handlers). (2) Align the item field — rename
backend `menu_item_id` → `item_id` (spec-first) or change the client. (3) Fix the admin
payout types/paths: map to the backend `PayoutRun` shape, fetch lines from
`GET …/payouts/:id`, and add a `buildPayoutRun(...)` call + UI trigger.

---

## Journey 7 — Crypto: withdrawal request → admin AML approve → ledger; reconciliation

| Step | File | Status | Note |
|------|------|--------|------|
| 1. Mobile client | `src/features/crypto/api/crypto.api.ts:48,604-652` | OK (path) | Mock default `true`. Live withdraw `POST /api/v1/crypto/withdrawals` + `Idempotency-Key`. Mock returns terminal `WithdrawalPendingReview` (never broadcasts). |
| 2. Backend module | `backend/internal/crypto/*.go` | OK | Full module present. |
| 3. Route + flag | `finance_routes.go:2349-2355`; `crypto/routes.go:83,107` | OK | Gated `FeatureCryptoEnabled` (**default false**). Withdraw `PermTrade`; admin decision `PermAdmin`. |
| 4. Member Withdraw handler | `crypto/handler_ext.go:236-268` | OK | `requireIdem` fail-closed; RBAC `crypto.trade`. |
| 4a. **Member Withdraw service** | `crypto/service_ext.go:346-449` | **BROKEN (design conflict)** | Fail-closed guards present (allow-list address, holdings check, dup-replay), and fee ledgered double-entry (wallet → `paymax_revenue`, `:402-413`). BUT it synchronously drives `requested → pending → broadcast` and dispatches to the provider. It does **not** stop at `requested` for AML review. Money leaves before any human review. |
| 5. **Admin AML approve** | `crypto/admin_service.go:39-81` | **BROKEN (unreachable)** | Approve = `requested → pending`, guarded `WHERE status='requested'`. Since hop 4a already advanced past `requested`, the queue never has a `requested` row → approve returns `ErrInvalidTransition`. |
| 5a. Admin AML UI | `frontend-admin/app/admin/crypto/withdrawals/page.tsx:62` | OK (UI) | Queue filters `status==='requested'` — permanently empty due to hop 4a. RBAC + mandatory operator note correct. |
| 6. Reconciliation | `crypto/admin_service.go:156-204` | OK | Diffs on-chain (`OnchainUnitsByAsset`) vs ledger (`AdminHeldUnitsByAsset`); read-only. |
| 6a. `no_feed` branch | `admin_service.go:181-189`, `admin_model.go:98` | OK | Asset absent from `crypto_onchain_balances` → `Status=no_feed`, `drift=0`, not a break. Recon UI renders it distinctly (amber). |
| 6b. Custody feed | `crypto/onchain.go:170-236` | OK | Shared-secret guarded, **fail-closed 503** when secret unset; constant-time compare. |
| 7. **DB tables** | (none) | **BROKEN (missing)** | No `.sql` migration defines `crypto_withdrawals`, `crypto_onchain_balances`, `crypto_assets`, `crypto_addresses`, `crypto_audit_log`. `onchain.go:17` cites a migration filename that does not exist. |
| 8. Manual-review gate alignment | mobile `crypto.api.ts:588` vs backend | BROKEN | Mobile mock + admin UI assume "every withdrawal → manual AML before broadcast"; backend has no such gate. |

**Verdict: BROKEN — CRITICAL.** Wiring, RBAC, idempotency, audit, fail-closed guards, and
the reconciliation `no_feed` handling are all correct, but the core journey is
self-contradictory: the member path **auto-broadcasts** (`requested → pending → broadcast`
in one synchronous call), so the AML approve step is structurally unreachable and **money
can leave before AML review**. Additionally there are **no crypto DB migrations**, so with
the flag off (default) and no schema, the live path cannot run at all — mock-only in
practice.

**Fix:** (1) Make AML approve the gate: in `Withdraw` stop after creating the `requested`
row and charging the fee (remove/guard the auto `requested → pending → broadcast`), and
move the provider broadcast into `AdminDecideWithdrawal` approve. Flow becomes member POST
→ `requested` (units parked, fee charged, audited) → admin approve → broadcast; reject →
returns parked units. Keep idempotency + holdings check + audit. (2) Add the additive
`crypto_*` migrations including `crypto_onchain_balances` and a `crypto_withdrawals.status`
CHECK matching the FSM (`model_ext.go:94-100`).

---

## Journey 8 — Connect (dating) discovery

Mobile `/connect/discover` → `GET /api/v1/connect/discovery/stack` → discovery stack.

| Step | File | Status | Note |
|------|------|--------|------|
| 1. Discover tab | `app/connect/(tabs)/discover.tsx:6` → `app/connect/discovery/stack.tsx:60-181` | OK | Renders `profiles` from `stackQuery.data`. |
| 2. API client | `src/features/connect/discovery/api.ts:168-186` | OK | `GET ${BASE}/discovery/stack?limit=20`; unwraps `{profiles}`. Mock default `true` (`connect.constants.ts:8,21`). |
| 3. Handler | `backend/internal/connect/discovery/member_handler.go:75-98` | OK | Returns `{"profiles": cards}`. |
| 4. Service + repo | `connect/discovery/stack.go:90-159` | OK | Candidate query excludes self/prior-like/match/passed; ranks; caps limit. |
| 5. Route wiring | `router.go:349-350` → `connect_routes.go:26-91` → `connect_phase1_routes.go:134` | OK | Gated `FeatureConnectEnabled`+pool; `member.GET("/discovery/stack", discoveryGate, Stack)`; RBAC `connect.discovery.access` (fail-closed 403 if unseeded). |
| 6. **Response shape** | `connect/discovery/model.go:17-25` vs `types.ts:34-55` + `stack.tsx:171-181` | **BROKEN (partial)** | Backend `ProfileCard` returns only `profileId, displayName, city, verified(bool), intentTags, distanceLabel`. UI unconditionally reads `current.id` (undefined → breaks nav/key), `current.photos[0]` (**runtime crash** — undefined), `age`, `prompts[0]`, `headline`; and passes `verified` (bool) to a component expecting `VerificationFlag[]`. |
| 7. DB tables | `20260702000000_connect_phase1_core.sql`, `20260903000000_connect_discovery_boosts.sql` | OK | `connect_profiles`, `connect_profile_modes`, `connect_likes`, `connect_matches`, `connect_passes`, `connect_boosts` all present. |
| 8. "Earlier fixes hold" | `api.ts:26-72`, `stack.go`, `member_handler.go` | OK | No FIX/BUG regression markers; prior fixes appear baked in and holding (ProfileRequiredError mapping, defensive `unwrapProfiles`, `liveOrDefault` degradation, superlike direction, pass-supersedes-like, canonical `orderPair`). |

**Verdict:** Wiring is **coherent** (path, method, flag, RBAC, handler→service→repo→DB,
migrations all align) and the earlier discovery fixes hold. But the **live response shape
is not fully aligned**: in `USE_MOCK=false` the stack call succeeds yet returns a leaner
card than the UI renders, and `current.photos[0]` **crashes at runtime**. Invisible in the
default mock build.

**Fix (backend-preferred, brownfield-additive):** Enrich `ProfileCard`/`cardFrom`
(`model.go`, `stack.go:61-74`) to emit `id` (alias `profileId`), `photos`, `age`,
`prompts`, `bio`, `interests`, and change `verified` to the string-flag array, from the
joins the query already runs. (Client-side defaulting in `unwrapProfiles` avoids the crash
but can't supply real `photos`/`age`.) Also confirm the `connect.discovery.access` RBAC
seed ran before go-live, or the live stack 403s before any of this matters.

---

## Cross-cutting observations

- **Mock-first everywhere:** all mobile modules default `USE_MOCK=true`. Static traces of
  the *live* path are the only meaningful QA; a passing mock demo proves nothing about the
  wired system.
- **`amountKobo` vs `amountMinor`:** a recurring client/backend field-name divergence
  across fees payment, vault contribute, and (shape-wise) restaurant/connect. A single
  contract-first pass (`contracts/openapi.yaml`) would catch all of these; run
  `npm run contract:check`.
- **Idempotency-Key header vs body:** the fees/vault handlers correctly read the header;
  the restaurant `PlaceOrder` handler is the outlier that binds it from the body — the one
  money handler that breaks on the standard client convention.
- **Guards asserted in comments, not code:** promotion approval routes carry a doc-comment
  demanding distinct RBAC slugs but register with `_ = rbac`. The crypto AML gate is
  assumed by the UI/mock but absent on the money path. Compliance intent is documented; the
  enforcement wiring is incomplete.
- **Compliance cores are sound:** the SF-3 promotion two-approval service (state machine +
  distinct-approver assert + DB CHECK) and the SF-7 minor-safe serializer (default-strip,
  fail-closed) are correctly implemented in the backend — the risk in those journeys is
  reachability/wiring, not the invariant.
