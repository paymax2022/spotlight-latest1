# Module: Top5 Events (Ticketing + Cashless Event Wallet)

**Risk tier:** 0 · **Money-path:** yes (ticket purchase, cashless event wallet, vendor settle) · **Feature flag:** `FEATURE_EVENTS_ENABLED` (`FeatureEventsEnabled`; sibling flags gate P1/P2/P3 route tiers: commission/savings/socialpay/loyalty/creators)
**Code:** `backend/internal/top5events/` (`handler.go`, `service.go`, `reconciler.go`, `model.go`; tests `service_money_test.go`, `service_mirror_test.go`, `service_integration_test.go`, `service_durability_test.go`, `handler_test.go`) · route tiers `internal/app/top5_p1_routes.go`, `top5_p2_routes.go`, `top5_p3_routes.go`
**Slug:** `TOP5EVENTS`

## 1. Overview & scope

Event lifecycle + ticketing + a **cashless event wallet** (attendees top up a per-event wallet
and vendors charge against it), with a **pending-order reconciler**. Money-path throughout —
ticket purchase, wallet topup, vendor charge, and admin vendor settlement inherit
`../cross-cutting/money-invariants.md` (integer kobo, idempotent, balanced). A pending-order
reconciler must converge orphaned payments. Cross-cutting: money invariants, authentication,
RBAC on admin (approve/suspend/settle).

## 2. Services / endpoints in scope (grounded in `handler.go`)

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| Get event | `GET /:id` | member | no |
| Submit / go-live / close | `POST /:id/submit`, `/:id/golive`, `/:id/close` | organiser | no |
| Configure tiers/promos/vendors | `POST /:id/tiers`, `/:id/promos`, `/:id/vendors` | organiser | no |
| Purchase ticket | `POST /:id/purchase` | member, Idempotency-Key | **yes** |
| Gift ticket | `POST /tickets/:ticketId/gift` | ticket owner | transfer |
| My tickets | `GET /my/tickets` | owner | no |
| Scan / validate ticket | `POST /scan` | steward | no |
| Create event wallet | `POST /:id/wallet` | member | yes (open) |
| Topup / get / close wallet | `POST /wallet/:walletId/topup`, `GET /wallet/:walletId`, `POST /wallet/:walletId/close` | wallet owner | **yes** |
| Vendor charge | `POST /vendors/:vendorId/charge` | vendor | **yes** |
| Admin approve/suspend event | `POST /:id/approve`, `/:id/suspend` | admin (RBAC) | no |
| Admin vendor settle | `POST /:id/vendors/:vendorId/settle` | admin (RBAC) | **yes** |

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage | Status |
|---|---|---|---|
| Money invariants (purchase/topup/charge) | unit | `internal/top5events/service_money_test.go` | AUTOMATED |
| Ledger mirror consistency | unit | `internal/top5events/service_mirror_test.go` | AUTOMATED |
| Durability (crash/replay) | unit | `internal/top5events/service_durability_test.go` | AUTOMATED |
| Service + DB integration | int | `internal/top5events/service_integration_test.go` | AUTOMATED |
| Handler routing/status | unit | `internal/top5events/handler_test.go` | AUTOMATED |
| Reconciler convergence | int | `reconciler.go` (covered) | PARTIAL |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| TOP5EVENTS-FSM-001 | Event lifecycle | P1 | organiser, flag on | draft → submit → approve → golive → close | — | Only legal transitions; purchase blocked before golive / after close |
| TOP5EVENTS-INV-001 | Ticket purchase idempotent | P0 | funded member | `POST /:id/purchase` twice, same key | same key | Single debit; one ticket issued |
| TOP5EVENTS-INV-002 | Purchase respects tier price/stock | P0 | tier with limited stock | Purchase at boundary and beyond stock | kobo | Correct price charged; sold-out rejected; no oversell |
| TOP5EVENTS-INV-003 | Wallet topup balanced | P0 | event wallet | Topup twice same key | same key | Single credit; balance == ledger projection |
| TOP5EVENTS-INV-004 | Vendor charge ≤ wallet balance | P0 | wallet balance B | Vendor charges > B | over | Rejected; balance untouched |
| TOP5EVENTS-INV-005 | Vendor charge idempotent | P0 | funded wallet | Double-charge same key | same key | Single debit |
| TOP5EVENTS-INV-006 | Wallet close refunds remainder | P0 | wallet with balance | `POST /wallet/:id/close` | — | Remaining balance returned via ledger; wallet closed; no residual |
| TOP5EVENTS-AUTHZ-001 | Vendor charge auth | P0 | vendor A, wallet of attendee | Vendor B charges A's-event wallet | — | Only registered event vendor can charge |
| TOP5EVENTS-AUTHZ-002 | Ticket gift ownership | P0 | ticket owned by A | B gifts A's ticket | — | 403 — only owner gifts |
| TOP5EVENTS-AUTHZ-003 | Admin settle RBAC | P0 | non-admin | `POST /:id/vendors/:vendorId/settle` | — | 403 |
| TOP5EVENTS-INT-001 | Vendor settlement conservation | P0 | vendor with charges | Settle vendor | kobo | Payable = charges − fees, kobo-exact; balanced; audit |
| TOP5EVENTS-INT-002 | Pending-order reconciler converges | P0 | orphaned pending purchase | Run reconciler | — | Pending order resolved to paid/failed exactly once; no double-issue |
| TOP5EVENTS-SEC-001 | Ticket scan replay | P1 | valid ticket | Scan same ticket twice | — | First admits; replay flagged as already-used |
| TOP5EVENTS-SEC-002 | Flag-off inaccessible | P0 | `FEATURE_EVENTS_ENABLED` off | Call any route | — | Not mounted / 404 (FLAG-SEC-001) |

## 5. State-machine transitions

**Event:** draft → submitted → approved → live → closed (+ suspended). **Event wallet:** open →
active → closed. **Order:** pending → paid | failed (reconciler-driven). Illegal transitions
rejected; terminal states idempotent (durability test asserts replay safety).

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| approved | golive | live | tickets purchasable | TOP5EVENTS-FSM-001 |
| live | close | closed | purchases blocked | TOP5EVENTS-FSM-002 |
| pending | reconcile-success | paid | ticket issued once | TOP5EVENTS-INT-002 |
| active(wallet) | close | closed | remainder refunded | TOP5EVENTS-INV-006 |

## 6. Security & abuse cases

Idempotency on purchase/topup/charge; oversell prevention; vendor-charge authz; ticket
ownership on gift; scan replay; admin-settle RBAC; reconciler exactly-once; wallet close leaves
no residual. Money invariants per cross-cutting.

## 7. Automated specs to add

- Reconciler exactly-once integration test under concurrent duplicate settlement.
- Oversell concurrency test at the tier-stock seam.
- Wallet-close residual-zero assertion (extend `service_money_test.go`).

## 8. Coverage target & exit criteria

Money funcs ≥ 85%. Exit: purchase/topup/charge idempotent + balanced, no oversell, vendor
settlement conserves kobo-exact, reconciler converges once, flag gates access.
