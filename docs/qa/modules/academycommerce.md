# Module: Academy Commerce

**Risk tier:** 1 &nbsp;·&nbsp; **Money-path:** yes &nbsp;·&nbsp; **Feature flag:** `FEATURE_ACADEMY_ENABLED` (no dedicated sub-flag — registered unconditionally inside `RegisterAcademy`; child-safety purchase gate only wired when `FEATURE_ACADEMY_SPINE_ENABLED` is on)
**Code:** `backend/internal/academy/commerce/` — `handler.go`, `service.go`, `model.go`, `statemachine.go`, `repository.go`, `rails.go`, `approval.go`, `commerce_test.go`; wiring in `backend/internal/app/academy_routes.go` (`RegisterAcademyCommerce`, `academyApprovalGate`), rail adapter in `academy_rails.go` (`academyLedgerRail.Charge`).
**Slug:** `ACADEMYCOMMERCE`

## 1. Overview & scope

Course/plan/exam-bundle purchase surface for the academy. A learner creates an order for a
catalog item (`plan` or `bundle`), then pays it via the Paymax wallet ledger (`PayNow`),
Buy-Now-Pay-Later (`StartBNPL`), a scratch **access card** (serial + PIN), or a subscription.
Successful payment grants an idempotent **entitlement**. Admins refund, generate/allocate access
cards, and read a payments overview. Money moves on the real ledger via `academyLedgerRail.Charge`
(debit buyer wallet → `AccountEscrow` standing account) — **no shadow ledger**. Prices are locked
server-side from the catalog; the client never supplies an amount.

Applicable cross-cutting: `../cross-cutting/money-invariants.md` (all money cases — I1–I12 run
against `orders/:id/pay`, `/bnpl`, `access-cards/activate`, `subscribe`, admin `refund`),
`../cross-cutting/authentication.md` (member routes read identity from token, never body),
`../cross-cutting/rbac-and-permissions.md` (admin group gated `academy.commerce`),
`../cross-cutting/feature-flags-and-audit.md` (flag-off + audit on every mutation).

## 2. Services / endpoints in scope

Member base `/api/finance/academy/commerce`; admin base `/api/academy/commerce/admin` (group
guarded `RequirePermission("academy.commerce")`).

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| List plans / bundles | `GET /plans`, `GET /bundles`, `GET /bundles/:id`, `GET /bundles/:id/manifest` | auth (member) | no |
| Create order | `POST /orders` | auth; owner | no (locks price) |
| Pay order (wallet) | `POST /orders/:id/pay` | auth; owner + `Idempotency-Key` + ApprovalGate | **yes** |
| BNPL order | `POST /orders/:id/bnpl` | auth; owner + `Idempotency-Key` + ApprovalGate | **yes** |
| Activate access card | `POST /access-cards/activate` | auth; owner + `Idempotency-Key` | **yes** (grants entitlement) |
| Subscribe | `POST /subscribe` | auth; owner + `Idempotency-Key` | **yes** |
| Offline sync ingest | `POST /sync` | auth | no |
| Admin refund | `POST /admin/orders/:id/refund` | `academy.commerce` + `Idempotency-Key` | **yes** (state + audit; rail reversal out-of-band) |
| Generate card batch | `POST /admin/access-cards/generate` | `academy.commerce` | no (issues PINs) |
| Allocate cards | `POST /admin/access-cards/allocate` | `academy.commerce` | no |
| List cards / payments overview / plans / bundles | `GET /admin/access-cards`, `GET /admin/payments/overview`, `GET /admin/plans`, `GET /admin/bundles` | `academy.commerce` | no |

Amounts are `int64` minor units (kobo) named `*Minor` (`PriceMinor`, `AmountMinor`). Idempotency
via `academy_idempotency_keys` (UNIQUE `(idempotency_key, scope)`); scopes: `order.pay_now`,
`order.bnpl`, `subscription.subscribe`, `access_card.activate`, `order.refund`.

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage | Status |
|---|---|---|---|
| Order FSM legal transitions | unit/fsm | `commerce_test.go::TestCanOrder_AllowedTransitions` | AUTOMATED |
| Order FSM illegal transitions | unit/fsm | `commerce_test.go::TestCanOrder_IllegalTransitions` | AUTOMATED |
| Access-card FSM | unit/fsm | `commerce_test.go::TestCanCard_Transitions` | AUTOMATED |
| PIN salted-hash verify round-trip | unit/sec | `commerce_test.go::TestPIN_VerifyRoundTrip`, `TestPIN_SaltedUnique`, `TestRandomPIN_Length`, `TestSplitHash` | AUTOMATED |
| Idempotency request-hash determinism | unit/inv | `commerce_test.go::TestRequestHash_Deterministic` | AUTOMATED |
| Rail idempotent ref | unit | `commerce_test.go::TestStubPaymentRail_IdempotentRef`, `TestStubBNPLRail_IdempotentRef`, `TestPick` | AUTOMATED |
| Sync classification | unit | `commerce_test.go::TestClassifySync_KnownAndUnknown` | AUTOMATED |
| Pay/BNPL against real ledger (debit→escrow, replay no-op) | integration | — | TODO |
| Approval gate blocks minor purchase | integration | — | TODO |
| Admin refund authz + audit | integration/authz | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `ACADEMYCOMMERCE-INT-001` | Create order locks catalog price | P0 | plan `P` priced `500000` | `POST /orders {kind:"plan", refId:P}` | — | Order `state=checkout`, `amountMinor=500000` (server-locked); client amount ignored |
| `ACADEMYCOMMERCE-INT-002` | Pay order debits wallet once | P0 | order in `checkout`, wallet ≥ price | `POST /orders/:id/pay` + `Idempotency-Key` | key ≥8 chars | Rail `Charge` debits buyer → `AccountEscrow` exactly once; order `paid`→`entitled`; entitlement granted |
| `ACADEMYCOMMERCE-INT-003` | BNPL activates plan | P1 | order `checkout` | `POST /orders/:id/bnpl` + key | — | `StartPlan` called once; order `bnpl_active`→`entitled`; entitlement `source="bnpl"` |
| `ACADEMYCOMMERCE-INT-004` | Access-card activation grants entitlement | P1 | generated card serial+PIN | `POST /access-cards/activate {serial,pin}` + key | valid PIN | Card `activated`; entitlement `source="access_card"`; card FSM terminal |
| `ACADEMYCOMMERCE-INT-005` | Subscribe = order + pay | P1 | plan `P` | `POST /subscribe {planId:P}` + key | — | Returns `{order, subscription}`; single wallet debit (child key `:pay`) |
| `ACADEMYCOMMERCE-VAL-001` | Unknown order kind rejected | P1 | — | `POST /orders {kind:"xyz"}` | invalid kind | 400; nothing created |
| `ACADEMYCOMMERCE-VAL-002` | RefID with no catalog price rejected | P0 | plan with zero/absent price | `POST /orders` | — | `ErrInvalidAmount`; no order (never a free grant) |
| `ACADEMYCOMMERCE-VAL-003` | Wrong access-card PIN rejected | P1 | card exists | activate with wrong PIN | bad PIN | Rejected; card unchanged; PIN checked constant-time |
| `ACADEMYCOMMERCE-INV-001` | Idempotent replay — no double charge | P0 | paid order | Re-POST `/pay` same key | same key | Same result; ledger entry count unchanged (see `../cross-cutting/money-invariants.md` MONEY-INV-006) |
| `ACADEMYCOMMERCE-INV-002` | Concurrent same-key → one charge | P0 | order `checkout` | Fire N=10 concurrent `/pay`, one key | N=10 | Exactly one debit; MONEY-INV-007 |
| `ACADEMYCOMMERCE-INV-003` | Missing Idempotency-Key rejected | P0 | order `checkout` | `POST /pay` no key | — | `ErrIdempotencyRequired` → 400; MONEY-INV-008 |
| `ACADEMYCOMMERCE-INV-004` | Reused key, different body → conflict | P1 | key used for order A | Re-use key on order B `/pay` | different orderId | `ErrIdempotencyKeyReused`; B not charged |
| `ACADEMYCOMMERCE-INV-005` | Overdraw rejected | P0 | wallet < price | `POST /pay` | insufficient funds | Rejected fail-closed; order stays `checkout`; MONEY-INV-005 |
| `ACADEMYCOMMERCE-AUTHZ-001` | Non-owner cannot pay another's order | P0 | order owned by user A | user B `POST /orders/:id/pay` | A's orderId | 403/404; `GetOrder` is user-scoped (IDOR) |
| `ACADEMYCOMMERCE-AUTHZ-002` | Admin route denies non-holder | P0 | caller without `academy.commerce` | `POST /admin/orders/:id/refund` | — | 403 `forbidden`; see RBAC-AUTHZ-001 |
| `ACADEMYCOMMERCE-AUTHZ-003` | Refund allowed for holder + audited | P0 | `entitled` order; caller holds perm | `POST /admin/orders/:id/refund` + key | — | Order `refunded`; entitlement revoked; compensating audit row |
| `ACADEMYCOMMERCE-VAL-004` | Card batch count bounds | P2 | — | `POST /admin/access-cards/generate {count}` | 0 and 5001 | Rejected (allowed 1–5000); PIN plaintext returned once only |
| `ACADEMYCOMMERCE-SEC-001` | Refund on non-entitled order rejected | P1 | order in `checkout` | Attempt refund | — | Illegal transition rejected (only `entitled`→`refunded`) |
| `ACADEMYCOMMERCE-SEC-002` | Minor purchase requires guardian approval | P0 | buyer has active guardian link; spine flag on | `POST /orders/:id/pay` | minor buyer | 403 `approval_required`; pending `academy_purchase_approvals` row; no charge until approved |
| `ACADEMYCOMMERCE-SEC-003` | Flag-off route inaccessible | P0 | `FEATURE_ACADEMY_ENABLED` off | Call any commerce endpoint | — | Not mounted / 404 — never 500 (see `../cross-cutting/feature-flags-and-audit.md` FLAG-SEC-001) |

## 5. State-machine transitions

**Order** (`academy_orders.state`, `canOrder`):

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| cart | begin checkout | checkout | — | `ACADEMYCOMMERCE-FSM-001` |
| checkout | pay | paid | wallet debit via rail | `ACADEMYCOMMERCE-FSM-002` |
| checkout | bnpl | bnpl_active | BNPL plan started | `ACADEMYCOMMERCE-FSM-003` |
| paid | grant | entitled | entitlement created | `ACADEMYCOMMERCE-FSM-004` |
| bnpl_active | grant | entitled | entitlement (`source=bnpl`) | `ACADEMYCOMMERCE-FSM-005` |
| entitled | refund | refunded (terminal) | entitlement revoked + audit | `ACADEMYCOMMERCE-FSM-006` |

**Access card** (`academy_access_cards.state`, `canCard`): `issued → allocated|activated|void`,
`allocated → activated|void`; `activated` and `void` terminal. `ACADEMYCOMMERCE-FSM-007`.

Illegal transitions asserted rejected (`TestCanOrder_IllegalTransitions`, `TestCanCard_Transitions`):
skip (`cart→entitled`), backwards, re-entering terminal (`refunded→*`, `activated→*`), unknown state.
Re-activation of an `activated` card is handled by **idempotency replay**, not a transition.

## 6. Security & abuse cases

- **Amount tampering:** price is locked from catalog; a client-supplied amount is ignored
  (`ACADEMYCOMMERCE-VAL-002`). Re-derive server-side per `money-invariants.md §3`.
- **IDOR:** member order reads are `user_id`-scoped; admin refund uses `GetOrderAny` and requires
  the permission (`ACADEMYCOMMERCE-AUTHZ-001/002`).
- **PIN handling:** stored salted SHA-256, never serialized (`pin_hash` never selected); plaintext
  returned once at generation only.
- **Idempotency-Key** mandatory + scoped; reuse across operations blocked by `(key, scope)` unique.
- **Child-safety gate** fail-closed via active guardian link (`ACADEMYCOMMERCE-SEC-002`).
- **Spoofed `user_id` in body** must be ignored — token identity is authoritative
  (`authentication.md §4`).

## 7. Automated specs to add

- `commerce/live_db_pay_test.go` — `PayNow`/`StartBNPL` against real ledger: debit→`AccountEscrow`,
  balanced journal, replay no-op, concurrent same-key single success (I2/I5/I6). TODO.
- `commerce/approval_gate_test.go` — minor with active guardian link blocked with `approval_required`,
  approved retry succeeds. TODO.
- `commerce/refund_authz_test.go` — admin refund denied without `academy.commerce`, allowed with,
  emits one compensating audit event. TODO.

## 8. Coverage target & exit criteria

Pure-logic (`statemachine.go`, PIN, request-hash) ≥ 85% — already largely covered by
`commerce_test.go`. Exit: all P0 (`INT-002`, `INV-001..005`, `AUTHZ-001/002`, `SEC-002/003`) green;
no double-charge under replay/concurrency; refund path audited; flag-off proven inaccessible.
