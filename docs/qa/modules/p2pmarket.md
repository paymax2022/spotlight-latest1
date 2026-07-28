# Module: P2P Marketplace (escrow)

**Risk tier:** 1 &nbsp;·&nbsp; **Money-path:** yes (escrow hold / release / refund via the shared escrow core) &nbsp;·&nbsp; **Feature flag:** `FEATURE_P2P_MARKET_ENABLED`
**Code:** `backend/internal/p2pmarket/` — `handler.go`, `service.go`, `model.go` (no in-package `*_test.go`)
**Mounting:** `backend/internal/app/top5_p3_routes.go` (`RegisterP2PMarket`), invoked from `backend/internal/app/finance_routes.go:443` guarded by `cfg.FeatureP2PMarketEnabled && pool != nil`. Member group `finance.Group("/p2p")` (base `/api/finance/p2p`); admin group `adminGroupTop5(r, "/api/p2p/admin")`.
**Slug:** `P2P` (uppercase, used in Case IDs)

## 1. Overview & scope

The P2P Marketplace is the Phase-3 peer-to-peer escrow marketplace: peer listings, escrow-backed checkout, a dispute/arbitration loop, and one-time seller ratings. It **owns listings/orders/ratings but delegates ALL money + dispute mechanics to the shared escrow core** (`internal/escrow`): checkout = `escrow.Hold`, confirm = `escrow.Release`, dispute = `escrow.RaiseDispute`, arbitration = `escrow.Arbitrate`. Per the package doctrine — **NL-6** (funds sit held, never lent), **NL-9** (checkout idempotent on key), **NL-10** (AML inherited from escrow), **NL-12** (audit). The money never moves inside `p2pmarket` itself; the escrow core debits the buyer wallet into the shared escrow standing account on Hold (tier-limit + insufficient-funds **fail closed** there), and releases to the seller (or refunds the buyer) on the appropriate terminal event.

Member routes are authenticated via the finance group (`RequireAuthContext`; actor is `user_id`) with **object-level authorization enforced in the service/escrow core** (seller owns listing; only the buyer confirms; escrow enforces party scoping on dispute; arbiter separation-of-duties in `escrow.Arbitrate`). The single admin route (`arbitrate`) is RBAC-guarded by `p2p.dispute.arbitrate`. Cross-cutting files that apply: `../cross-cutting/money-invariants.md` (escrow hold/release/refund balanced postings, idempotency), `../cross-cutting/authentication.md`, `../cross-cutting/rbac-and-permissions.md` (arbitrate guard), `../cross-cutting/kyc-and-tiers.md` (tier-limit fail-closed inside `escrow.Hold`), `../cross-cutting/feature-flags-and-audit.md` (flag-off + NL-12 audit sink).

> Note: the `RegisterP2PMarket` doc-comment says "Called under FeatureSocialPayEnabled" — this is **stale**; the real gate in `finance_routes.go:443` is `cfg.FeatureP2PMarketEnabled` (`FEATURE_P2P_MARKET_ENABLED`). Also observe the route registration builds `member.POST("/p2p/listings", …)` on top of a `/api/finance/p2p` group, so the effective external path is `/api/finance/p2p/p2p/listings` (a doubled `/p2p` segment); the tables below list the handler-relative sub-paths and note this.

## 2. Services / endpoints in scope

Paths are handler-relative (registered on the member/admin groups; see the doubled-prefix note above). Member base `/api/finance/p2p`, admin base `/api/p2p/admin`.

| Operation | Method + path (handler-relative) | Auth / permission | Money-path? |
|---|---|---|---|
| Create listing | `POST /p2p/listings` | auth; seller = caller | no |
| Browse active listings | `GET /p2p/listings` | auth | no |
| Get listing | `GET /p2p/listings/:listingId` | auth | no |
| Close own listing | `POST /p2p/listings/:listingId/close` | auth + OLA (seller owns, ACTIVE) | no |
| **Checkout (hold funds)** | `POST /p2p/listings/:listingId/checkout` (**Idempotency-Key**) | auth; buyer = caller | **yes** (`escrow.Hold`) |
| **Confirm receipt (release)** | `POST /p2p/orders/:orderId/confirm` | auth + OLA (only buyer) | **yes** (`escrow.Release`) |
| **Raise dispute** | `POST /p2p/orders/:orderId/dispute` | auth; escrow enforces party | **yes** (`escrow.RaiseDispute`) |
| Rate seller | `POST /p2p/orders/:orderId/rate` | auth + OLA (only buyer, CONFIRMED, once) | no |
| Seller rating aggregate | `GET /p2p/sellers/:sellerId/rating` | auth | no |
| **Arbitrate dispute (admin)** | `POST /p2p/orders/:orderId/arbitrate` | `p2p.dispute.arbitrate` + escrow separation-of-duties | **yes** (`escrow.Arbitrate`) |

Money legs (all in the escrow core, kobo integers): checkout debits buyer wallet → escrow standing account (`Hold`); confirm/release moves escrow → seller; arbitrate `RELEASE` → seller, `REFUND` → buyer.

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| Checkout holds funds, idempotent on key | inv | — (no in-package or `tests/` p2p suite found) | TODO |
| Confirm releases escrow to seller | inv | — | TODO |
| Dispute → arbitrate RELEASE/REFUND terminal legs | inv | — | TODO |
| Order lifecycle (CHECKOUT→CONFIRMED / DISPUTED→REFUNDED) | fsm | — (no explicit FSM map; guarded by state-equality checks in service) | TODO |
| Only buyer may confirm; only buyer may rate | authz | — | TODO |
| Arbiter cannot be a party (separation-of-duties) | authz | — (enforced in `escrow.Arbitrate`; assert via p2p) | TODO |
| Rate seller once, 1..5 bound, only after CONFIRMED | unit | — | TODO |
| Cannot buy own listing / listing not ACTIVE | unit | — | TODO |
| Checkout missing Idempotency-Key → 400 | con | — | TODO |
| Flag-off routes unregistered | sec | — | TODO |

> **No dedicated test files exist** for `p2pmarket` (`internal/p2pmarket/*_test.go` and `tests/*p2p*` both empty). Money-path behavior is only indirectly exercised through the shared escrow core's own tests. All specs below in §7 are net-new.

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `P2P-E2E-001` | Happy path: list → checkout → confirm → release | P0 | Seller S with listing; buyer B wallet funded ≥ price | S POST /listings → B checkout (Idempotency-Key k1) → B confirm | `price_kobo=500000` | Order CHECKOUT holds 500000 in escrow; confirm → CONFIRMED, 500000 released to seller wallet; listing SOLD |
| `P2P-INV-001` | Checkout idempotent — no double hold | P0 | Listing ACTIVE; buyer funded | POST /checkout twice with same `Idempotency-Key: k1` | `price_kobo=500000` | Same order returned; escrow debits buyer once (500000 kobo). See `../cross-cutting/money-invariants.md` |
| `P2P-INV-002` | Checkout missing Idempotency-Key | P0 | Buyer authed | POST /checkout with no header | — | 400 "Idempotency-Key header required"; no hold |
| `P2P-INV-003` | Insufficient funds / tier-limit fails closed | P0 | Buyer wallet < price OR over tier limit | POST /checkout | `price_kobo=500000`, balance `400000` | 400 with escrow hold error; no order row; no partial ledger entry (escrow fail-closed) |
| `P2P-UNIT-001` | Cannot buy own listing | P1 | Seller = buyer | S POST /checkout on own listing | — | 400 "cannot buy your own listing"; no hold |
| `P2P-UNIT-002` | Checkout on non-ACTIVE listing | P1 | Listing SOLD or CLOSED | POST /checkout | — | 400 "listing not available" |
| `P2P-UNIT-003` | Create listing price must be positive | P2 | Seller authed | POST /listings `price_kobo<=0` | `price_kobo=0` | 400 "price must be positive kobo" |
| `P2P-UNIT-004` | Close listing OLA + state guard | P1 | Listing owned by S, ACTIVE | Foreign user closes; owner closes SOLD listing | — | `ErrNotOwnerOrState` (0 rows affected) for non-owner / non-ACTIVE |
| `P2P-AUTHZ-001` | Only buyer may confirm receipt | P0 | Order in CHECKOUT, buyer B | Seller or third party POST /confirm | — | 403 `ErrNotParty`; escrow NOT released |
| `P2P-AUTHZ-002` | Only order buyer may rate, only after CONFIRMED | P1 | Order CONFIRMED, buyer B | Non-buyer rates; buyer rates a CHECKOUT order | `stars=5` | 403 `ErrNotParty` (non-buyer); 400 "can only rate a confirmed order" (wrong state) |
| `P2P-AUTHZ-003` | Rate seller only once | P1 | Order CONFIRMED, already rated | POST /rate again | `stars=4` | 400 "order already rated" (UNIQUE(order_id) → 0 rows) |
| `P2P-AUTHZ-004` | Arbitrate requires `p2p.dispute.arbitrate` | P0 | Caller lacks permission | POST /admin/…/arbitrate | `{decision:"RELEASE"}` | 403 (RBAC guard fail-closed). See `../cross-cutting/rbac-and-permissions.md` |
| `P2P-AUTHZ-005` | Arbiter cannot be a party (separation-of-duties) | P0 | Disputed order; arbiter = buyer or seller | Party attempts arbitrate | `{decision:"REFUND"}` | 403 `escrow.ErrArbiterConflict`; no money moved |
| `P2P-SEC-001` | Dispute by non-party rejected | P1 | Order CHECKOUT | Non-party POST /dispute | — | 403 `escrow.ErrDisputeNotParty` |
| `P2P-INV-004` | Arbitrate RELEASE vs REFUND terminal legs | P0 | Order DISPUTED, arbiter distinct | Arbitrate RELEASE (order A) / REFUND (order B) | `price_kobo=500000` | RELEASE → CONFIRMED, 500000 to seller; REFUND → REFUNDED, 500000 back to buyer; each a balanced escrow posting |
| `P2P-UNIT-005` | Stars out of range | P2 | Order CONFIRMED | POST /rate `stars=6` / `stars=0` | — | 400 "stars must be 1..5" |
| `P2P-SEC-002` | Flag-off: routes unregistered | P0 | `FEATURE_P2P_MARKET_ENABLED=false` | GET /api/finance/p2p/p2p/listings | — | 404 (routes never registered). See `../cross-cutting/feature-flags-and-audit.md` FLAG-SEC-001 |
| `P2P-SEC-003` | Dispute only on in-escrow (CHECKOUT) order | P1 | Order CONFIRMED/REFUNDED | POST /dispute | — | 400 "only an in-escrow order can be disputed" |

## 5. State-machine transitions

`p2pmarket` has **no explicit FSM map** (no `fsm*.go` / `statemachine*.go`); order state is enforced by inline state-equality guards in the service before delegating to the escrow core. The order lifecycle it enforces (state names from `model.go`):

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| (none) | checkout | CHECKOUT | `escrow.Hold` — buyer wallet → escrow; listing → SOLD | `P2P-E2E-001` |
| CHECKOUT | confirm (buyer only) | CONFIRMED | `escrow.Release` → seller | `P2P-E2E-001` |
| CHECKOUT | dispute (party) | DISPUTED | `escrow.RaiseDispute` | `P2P-SEC-001` |
| DISPUTED | arbitrate RELEASE | CONFIRMED | `escrow.Arbitrate` → seller | `P2P-INV-004` |
| DISPUTED | arbitrate REFUND | REFUNDED | `escrow.Arbitrate` → buyer | `P2P-INV-004` |
| CONFIRMED / REFUNDED (terminal) | confirm/dispute/arbitrate again | — | rejected: "order not in <required> state" (400); re-entry is a guarded no-op | `P2P-SEC-003` |

Illegal transitions to assert: confirm on non-CHECKOUT (400 "order not in CHECKOUT state"), dispute on non-CHECKOUT (400), arbitrate on non-DISPUTED (400 "order not in DISPUTED state"). Re-entering a terminal state (CONFIRMED/REFUNDED) must be rejected by the state guard, not double-move money. The deeper escrow-hold lifecycle FSM lives in `internal/escrow` — see that module's plan and `../cross-cutting/money-invariants.md`.

## 6. Security & abuse cases

- **IDOR / object-level:** `P2P-AUTHZ-001/002/003` — only the order buyer may confirm/rate; rating is one-shot via `UNIQUE(order_id)`; `CloseListing` scopes to `seller_id` + ACTIVE in the SQL WHERE.
- **RBAC + separation-of-duties:** `P2P-AUTHZ-004/005` — the arbitrate route is guarded by `p2p.dispute.arbitrate`, and the escrow core additionally forbids an arbiter who is a party (`ErrArbiterConflict`). Both must fail-closed. Reference `../cross-cutting/rbac-and-permissions.md`.
- **Idempotency / replay:** `P2P-INV-001/002` — checkout requires `Idempotency-Key`; the service short-circuits via `orderByIdem` + a DB `ON CONFLICT (idempotency_key) DO NOTHING`, and `escrow.Hold` is itself idempotent on the same key (NL-9). No key → 400.
- **Tier/KYC gate + fail-closed:** `P2P-INV-003` — `escrow.Hold` enforces tier-limit and insufficient-funds fail-closed BEFORE any order row is written; assert no dangling order and no partial ledger posting on failure. Reference `../cross-cutting/kyc-and-tiers.md`.
- **Amount tampering:** the held amount is the listing's server-stored `price_kobo` (read via `GetListing`), never a client-supplied value — assert the escrow hold equals the listing price exactly.
- **Settlement split:** p2p arbitration is binary (`RELEASE` | `REFUND`) — there is no partial split in `p2pmarket`; the balanced-posting guarantee is the escrow core's. Reference the settlement invariants in `../cross-cutting/money-invariants.md`.
- **Audit (NL-12):** every state-changing action logs via the injected `Auditor` (`p2p.listing.create`, `p2p.order.{checkout,confirm,dispute,arbitrate}`); the sink is nil-safe. Reference `../cross-cutting/feature-flags-and-audit.md`.
- **Injection:** listing title/description are free text bound via `ShouldBindJSON`; assert stored-and-echoed values are not interpreted (parameterized SQL is used throughout).

## 7. Automated specs to add

All specs are net-new (module currently has zero tests). Follow the table-driven Go convention used in `tests/marketplace/`.

- `internal/p2pmarket/service_test.go` — DB-free where possible with a fake escrow: cannot-buy-own-listing, non-ACTIVE listing, positive-price, close-listing OLA, stars-range, rate-once, confirm/dispute/arbitrate state guards. **TODO**
- `internal/p2pmarket/idempotency_test.go` — checkout idempotent (same key → same order, single hold); missing key → 400. **TODO**
- `tests/p2pmarket/escrow_flow_live_db_test.go` — live-DB (gated on `TEST_DATABASE_URL`) end-to-end: checkout holds exact kobo → confirm releases to seller; dispute → arbitrate REFUND returns exact kobo to buyer; assert balanced ledger postings. **TODO**
- `tests/p2pmarket/authz_test.go` — only-buyer-confirms/rates; non-party dispute → `ErrDisputeNotParty`; arbiter-is-party → `ErrArbiterConflict`; arbitrate RBAC guard allowed-vs-denied. **TODO**
- `tests/p2pmarket/flag_off_test.go` — with `FEATURE_P2P_MARKET_ENABLED=false`, assert `/api/finance/p2p/*` routes are not registered (404). Also regression-covers the stale doc-comment gate. **TODO**

## 8. Coverage target & exit criteria

Tier-1 target: **≥ 75% pure-logic coverage** on `service.go` (state guards + OLA + idempotency short-circuit) plus a live-DB escrow flow test for the money legs. **Exit criteria (release-ready):** all P0 cases green — `P2P-E2E-001` (hold→release), `P2P-INV-001/002/003` (idempotency + missing key + fail-closed), `P2P-INV-004` (arbitrate RELEASE/REFUND), `P2P-AUTHZ-001/004/005` (buyer-only confirm, arbitrate RBAC, arbiter separation-of-duties), `P2P-SEC-002` (flag-off). Escrow must hold/release/refund the exact listing `price_kobo` (kobo-exact), hold funds exactly once under replay, and never release/refund without the correct terminal transition. Because the module ships with **no tests today**, the checkout/confirm/arbitrate money paths must gain at least one automated invariant test each before go-live.
