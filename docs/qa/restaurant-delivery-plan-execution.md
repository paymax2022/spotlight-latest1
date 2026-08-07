# Restaurant & Delivery Test Plan — Execution Report

Execution of the 187-case `Restaurant_Delivery_Test_Plan.md` (v1.0) against the real code
(`backend/internal/restaurant/**` + settlement/ledger/webhooks/maps it touches). Read-only.

## Method & honesty caveat

- **Executed (real):** the restaurant module's pure unit suite is **green** — `canTransition`
  FSM (`transitions_test.go`), settlement split invariant (`split_invariant_test.go`),
  delivery-fee math (`deliveryfee_test.go`), reconciler, model. The **payout-run integration**
  (`tests/restaurantpayout`) was confirmed green earlier this session (after fixing its SQL bug).
- **Blocked (could not execute):** Docker/Supabase is **down**, so every DB-backed money/state
  assertion is **⚠️ Blocked** — statically verified in code but not run. Per the plan's own rule
  (§Appendix A), money/state cases are **not** marked ✅ on static reasoning; they are 🚧/⚠️.
- **➖ N/A:** the feature is genuinely **absent** from the module (confirmed by code search), not
  merely handled elsewhere.

Bottom line: the module is a **solid but minimal MVP** of restaurant ordering — the delivery-fee
engine, escrow/split money core, one-active-rider invariant, and object-level **reads** are
correct. But it is **far narrower than this "world-class" plan assumes**, and it has **two S1
authorization defects and one S2 money-integrity defect** that are release blockers.

## Execution rollup (static verification; DB-blocked where noted)

| Suite | Total | ✅ | ❌ | ⚠️ Blocked | 🚧 Partial | ➖ N/A |
|---|---|---|---|---|---|---|
| TS-1 Onboarding | 8 | 0 | 1 | 0 | 5 | 2 |
| TS-2 Menu | 11 | 4 | 0 | 0 | 2 | 5 |
| TS-3 Availability/Hours | 7 | 0 | 0 | 0 | 3 | 4 |
| TS-4 Discovery/Search | 8 | 1 | 2 | 1 | 1 | 3 |
| TS-5 Cart/Customization | 10 | 0 | 2 | 2 | 4 | 2 |
| TS-6 Pricing/Promos/Tips | 15 | 1 | 7 | 0 | 4 | 3 |
| TS-7 Checkout/Payment | 12 | 0 | 1 | 1 | 7 | 3 |
| TS-8 Order Lifecycle | 10 | 4 | 2 | 4 | 0 | 0 |
| TS-9 Restaurant Order Mgmt | 8 | 1 | 2 | 4 | 1 | 0 |
| TS-10 Dispatch | 8 | 1 | 5 | 1 | 1 | 0 |
| TS-11 Delivery/Tracking | 7 | 0 | 2 | 3 | 2 | 0 |
| TS-12 Proof of Delivery | 5 | 0 | 3 | 2 | 0 | 0 |
| TS-13 Cancel/Refund/Dispute | 10 | 0 | 0 | 5 | 2 | 3 |
| TS-14 Ratings | 5 | 0 | 0 | 0 | 4 | 1 |
| TS-15 Notifications | 5 | 0 | 1 | 0 | 3 | 1 |
| TS-16 Scheduled/Group | 5 | 0 | 0 | 0 | 0 | 5 |
| TS-17 Geo/Zones | 6 | 1 | 1 | 0 | 2 | 2 |
| TS-18 Payouts/Earnings | 8 | 0 | 1 | 3 | 3 | 1 |
| TS-19 RBAC/Security | 11 | 3 | 3 | 0 | 4 | 1 |
| TS-20 Non-Functional | 10 | 0 | 0 | 6 | 1 | 3 |
| TS-21 Edge/Chaos | 18 | 2 | 3 | 6 | 3 | 4 |
| **TOTAL** | **187** | **18** | **36** | **38** | **56** | **39** |

> "✅ 18" are only cases proven by a passing unit test or unambiguous code. "⚠️ 38" would move to
> ✅/❌ once Docker is up and the DB-backed suites run. "➖ 39" are absent features (see below).

## Deviations — the core finding, by theme

### A. Release-blocking defects (S1/S2 — verified in code, tasks filed)

| # | Sev | Deviation | Evidence | Task |
|---|---|---|---|---|
| 1 | **S1** | **`UpdateStatus` authorizes nobody.** Any authenticated user can drive any order's lifecycle; `→delivered` releases the 80/10/10 escrow (`settleOrder`), `→ready` fires dispatch. `:id` restaurant param never checked vs `order.restaurant_id`. | `service.go:353`, handler `:144` | **task_0357300b** |
| 2 | **S1** | **`CancelOrder` IDOR.** `actorID` used only to pick notify targets — any user can cancel + full-refund any pre-pickup order by id. | `service.go:524` | **task_0357300b** |
| 3 | **S1** | **POD is bypassable.** `ConfirmHandoff` enforces the delivery-code, but the unguarded `UpdateStatus` reaches `picked_up→delivered` (and settles) with no code and no rider check. | `service.go:353` vs `dispatch.go:138` | task_0357300b |
| 4 | **S2** | **Cancel-via-status strands escrow.** `UpdateStatus→cancelled` never refunds (only `delivered` settles); the reconciler sweeps only `delivered+escrowed`. Customer money held with no recovery. Two divergent cancel paths. | `service.go:353` vs `:524`; `reconciler.go` | **task_a29b17f0** |
| 5 | **S2** | **Cancel not transactional.** `SELECT status`→`Refund`→`UPDATE` with no `FOR UPDATE`/tx → cancel-vs-pickup race can refund AND settle the same escrow. | `service.go:524-535` | task_a29b17f0 |
| 6 | **S2** | **No per-transition audit trail** (plan invariant #3). Transitions emit only notify+WS broadcast; no immutable actor/time/from→to history. | module-wide; `service.go:392` | task_0357300b (folded) |
| 7 | **S3** | **`PlaceOrder` not idempotent-friendly.** Money-safe (escrow `ON CONFLICT` + `orders.idempotency_key` UNIQUE) but a double-tap returns **HTTP 500** on the UNIQUE violation instead of the original order. | `service.go:272` | **task_28fefa8f** (filed earlier) |

### B. Structural deviation — the plan assumes a super-app; the code is an MVP

The plan is written for a DoorDash/Uber-Eats-class product. Large swaths are **not implemented**:

- **No food-pricing engine** (TS-6): no **item modifiers/customization**, **service fee %**,
  **food surge**, **VAT/tax**, **promo codes** (%/fixed/free-delivery/stacking/min-spend/
  per-user/expiry), **tips**, **multi-currency**, or **signed price quote**. Order price =
  `Σ(item price × qty) + delivery fee`. *(7 ❌ in TS-6.)* Only the **delivery fee** is a real
  engine (distance/time tiers, surge, surcharges, clamps — all tests green).
- **FSM is 7 states, plan expects 17** (TS-8): missing `COMPLETED`, `REJECTED`,
  `AWAITING_PICKUP`, `IN_TRANSIT`, `DISPATCH_FAILED`, `PAYMENT_FAILED`, `DELIVERY_FAILED`,
  `REFUNDED`; `CANCELLED_*` collapsed to one `cancelled` with no actor/reason.
- **Money captured at PLACED, not ACCEPTED** (plan invariant #2): full amount escrowed at
  placement, released at `delivered` — no auth/capture separation.
- **Onboarding is a bare `is_open` boolean** (TS-1): no KYB, no PENDING_REVIEW/REJECTED states,
  approval grants **no merchant role** (only flips `is_open`), no duplicate-business control. The
  richer generic `internal/onboarding` engine exists but **isn't wired to restaurants**.
- **Availability is manual `is_open` only** (TS-3): no business hours, per-restaurant timezone,
  prep-time-in-ETA, holiday overrides, cutoff, or **accept-SLA auto-cancel**.
- **Discovery has no geo/zone filtering** and **no search/filters** (TS-4): every open restaurant
  is listed globally; out-of-zone orders are **not blocked** (`maps.InZone` exists but isn't
  wired — GEO-002). Distance fee is unbounded.
- **Dispatch is minimal** (TS-10): no timeout/`DISPATCH_FAILED`/auto-refund, no rider-offline
  reassign, no fairness/anti-starvation, no vehicle/zone eligibility, no explicit decline.
- **Delivery/POD gaps** (TS-11/12): tracking **never stops after delivery** (privacy), no
  photo/signature POD (code-only), no wrong-address/unreachable flow, no `DELIVERY_FAILED`.
- **Absent entirely:** scheduled & group orders (TS-16, all ➖), dispute/chargeback in-module
  (CN-007), partial refunds (CN-006), rider **tips/incentives** (PY-003), rate limiting
  (SEC-008), review moderation (RV-004), notification **dedup/SMS/opt-out** (NT-004/005 — ties
  to the separate `notifications` bug task_ccbe6e09), server-side XSS sanitization (SEC-007).
- **Payout is admin-RBAC-gated, not owner-only + step-up** (PY-007); disburses to a wallet, no
  verified bank account, no clawback.

### C. Confirmed strong controls (no deviation — keep these)

Delivery-fee math (executed green); **server-side total recompute** → inherent price-tamper
resistance (SEC-006 ✅); no mass-assignment of role/commission/price (SEC-005 ✅); **one-active-
rider** invariant + no double-assign (`AcceptDelivery` `FOR UPDATE` + offer expiry, DP-004/OL-006
✅); FSM guard rejects illegal/out-of-order transitions (OL-002/003/010 ✅); object-level **reads**
scoped (RM-007 ✅); idempotent escrow→settle with exact value conservation; **Paystack webhook
HMAC** verify + idempotent handlers (SEC-011/EC-010 ✅); SQL fully parameterized.

## Strategic approach to fixes (risk-ordered)

**Phase 0 — Block the release (do first, small, high-impact).** Fix the S1/S2 defects in
`internal/restaurant` — they are localized and test-provable:
1. **Authorization** (task_0357300b): gate `UpdateStatus`/`CancelOrder` by the order's resolved
   role (owner vs assigned rider vs customer) using the existing `orderParties`; validate
   `:id == order.restaurant_id`; **remove `delivered` from the generic status endpoint** so POD
   can't be bypassed; add an **audit event** per transition. Tests-first (non-participant → 403).
2. **Cancel money-integrity** (task_a29b17f0): route all cancellation through one guarded,
   **transactional** (`SELECT … FOR UPDATE`) method that refunds the escrow on `cancelled`;
   extend the reconciler to sweep `cancelled+escrowed`. Test the stranded-escrow + race.
3. **PlaceOrder idempotency** (task_28fefa8f): `ON CONFLICT (idempotency_key) … RETURNING` /
   read-back the existing order on replay instead of 500.
These are ~a few hundred lines total and each has a clear failing-test-first path.

**Phase 1 — Close the money/compliance gaps** the plan rightly demands: per-transition audit
trail (a `restaurant_order_events` table), **tier-limit gate** on the order escrow (CLAUDE.md
iron rule — currently only a balance check), and **delivery-zone enforcement** by wiring the
existing `maps.InZone` into `PlaceOrder` (block out-of-zone). Add **rider tips** to the model +
settlement split.

**Phase 2 — Decide scope, then build deliberately.** The big absent features (pricing engine with
modifiers/promos/tax/tips, real onboarding/KYB with role grant, business hours, search/filters,
dispatch SLA/fairness, scheduled/group orders, disputes) are **product decisions, not bugs** —
they're simply not built. Recommendation: **split the plan into "implemented-MVP" vs "roadmap"**,
gate each roadmap feature behind a flag, and design each as its own state-machine/config-driven
module (mirror the `academy/fees` or `kycverify` patterns already in the repo) rather than
bolting onto `PlaceOrder`. Drive the pricing engine from a versioned rate/promo schema so adding
a fee type or promo is a data change, not a deploy.

**Phase 3 — Executable regression + non-functional.** Once Docker/DB is available: run the
DB-backed money/state suites (the 38 ⚠️ Blocked cases), add the missing integration tests for the
Phase-0/1 fixes (they become the regression that stops these S1/S2 defects returning), and stand
up the perf/chaos harness (TS-20) for the checkout/dispatch/tracking hot paths.

## Traceability
Filed defects: **task_0357300b** (authz S1 + audit), **task_a29b17f0** (cancel escrow/race S2),
**task_28fefa8f** (PlaceOrder idempotency S3, earlier), **task_ccbe6e09** (notifications dedup,
earlier). This report is the executed companion to `Restaurant_Delivery_Test_Plan.md`; the §20
rollup above supersedes the plan's empty rollup for this run.
