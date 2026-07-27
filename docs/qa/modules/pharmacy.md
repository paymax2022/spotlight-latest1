# Module: Pharmacy (standalone catalog + cart)

**Risk tier:** 2 &nbsp;·&nbsp; **Money-path:** no (catalog + cart only; **no checkout/order/payment in this module**) &nbsp;·&nbsp; **Feature flag:** `FEATURE_PHARMACY_ENABLED`
**Code:** `backend/internal/pharmacy/` (`handler.go`, `service.go`, `model.go`, `handler_test.go`, `model_test.go`); wiring in `backend/internal/app/finance_routes.go:1463-1475`
**Slug:** `PHARMACY` (uppercase, used in Case IDs)

## 1. Overview & scope

`internal/pharmacy` is the **standalone** mobile-facing pharmacy surface mounted at
`/api/v1/pharmacy` behind `requireUserID()`. It is a thin catalog + shopping-cart module:
list products, and add/update/remove/clear cart items. Prices are integer **kobo**
(`Product.PriceKobo int64`), but **no order, checkout, payment, escrow, ledger, or payout code
exists here** — money never moves in this module. The richer clinical pharmacy (orders with
escrow Hold/Release/Refund, PCN dispense audit, recall, e-Rx verification) lives in
`backend/internal/health/pharmacy` and is covered by `../modules/health.md` §3 — do not conflate
the two.

Because there is no money mutation, the money-invariant cases in `../cross-cutting/money-invariants.md`
do **not** apply to this module. The one money-adjacent detail worth a case: `AddToCartRequest`
carries an `IdempotencyKey`, but `AddToCart` **stores it without enforcing idempotency** — the
`ON CONFLICT … DO UPDATE SET quantity = quantity + EXCLUDED.quantity` upsert increments on every
call, so a replayed add is *not* a no-op (`PHARMACY-INT-004`). QA focus: owner-scoped cart (IDOR),
input validation, and flag gating. Cross-cutting: `../cross-cutting/authentication.md`,
`../cross-cutting/feature-flags-and-audit.md`.

## 2. Services / endpoints in scope

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| List products (filter/search/paginate) | `GET /api/v1/pharmacy/products` | `requireUserID()` | no |
| Get my cart | `GET /api/v1/pharmacy/cart` | owner (`user_id`) | no |
| Add to cart (upsert-increment) | `POST /api/v1/pharmacy/cart` | owner | no |
| Update cart item qty | `PATCH /api/v1/pharmacy/cart/:product_id` | owner | no |
| Remove cart item | `DELETE /api/v1/pharmacy/cart/:product_id` | owner | no |
| Clear cart | `DELETE /api/v1/pharmacy/cart` | owner | no |

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| Products list needs auth | authz | `internal/pharmacy/handler_test.go` `TestListProductsNoAuth` | AUTOMATED |
| Add-to-cart bad/malformed body | contract | `handler_test.go` `TestAddToCartBadBody`, `TestAddToCartBadJSON` | AUTOMATED |
| Update-item bad body | contract | `handler_test.go` `TestUpdateCartItemBadBody` | AUTOMATED |
| Quantity must be positive (`min=1`) | contract | `handler_test.go` `TestQuantityMustBePositive` | AUTOMATED |
| Idempotency-Key header fallback | contract | `handler_test.go` `TestAddToCartIdempotencyHeaderFallback` | AUTOMATED |
| Product price is integer kobo | inv | `model_test.go` `TestPharmacyProductPriceKoboIsInteger` | AUTOMATED |
| AddToCart request validation / defaults | unit | `model_test.go` `TestAddToCartRequestValidation`, `TestListProductsQueryDefaults` | AUTOMATED |
| Category / document-type vocab | unit | `model_test.go` `TestProductCategoryValues`, `TestDocumentTypeValues` | AUTOMATED |
| Cart nil product safety | unit | `model_test.go` `TestCartItemNilProduct` | AUTOMATED |
| Owner-scoped cart (IDOR) | authz | — | TODO (needs DB seam) |
| Idempotency-Key NOT enforced (defect) | inv | — | TODO |
| Only in-stock products listed | int | — | TODO |
| Flag-off route not mounted | sec | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `PHARMACY-INT-001` | List products happy path | P1 | flag on, authed, seeded catalog | `GET /api/v1/pharmacy/products` | — | 200; `data[]`, only `in_stock=TRUE`, ordered bestseller then newest |
| `PHARMACY-INT-002` | Product filter + search + paginate | P2 | catalog with categories | `GET .../products?category=X&search=para&limit=5&offset=5` | — | 200; filtered by category + `name ILIKE`, limit/offset honored |
| `PHARMACY-INT-003` | Add to cart then read back | P1 | authed U | `POST .../cart {product_id:P,quantity:2}` then `GET .../cart` | qty 2 | 201; cart contains P qty 2 with joined product (`price_kobo` integer) |
| `PHARMACY-INT-004` | DEFECT: replayed add increments (not idempotent) | P1 | authed U | `POST .../cart {product_id:P,quantity:1,idempotency_key:K}` twice with same K | same K | Current: quantity becomes 2 (upsert increments; key stored but unused). Expected after fix: second call a no-op (qty stays 1). File as defect. |
| `PHARMACY-VAL-001` | Add-to-cart missing product_id | P1 | authed | `POST .../cart {quantity:1}` | no product_id | 400 (binding `required`) |
| `PHARMACY-VAL-002` | Add-to-cart malformed JSON | P2 | authed | `POST .../cart` with `{bad json` | — | 400 |
| `PHARMACY-VAL-003` | Update qty must be ≥1 | P1 | authed, item P in cart | `PATCH .../cart/P {quantity:0}` | qty 0 | 400 (`min=1`) |
| `PHARMACY-VAL-004` | Add-to-cart default quantity | P2 | authed | `POST .../cart {product_id:P}` (no qty) | — | 201; quantity defaults to 1 (`service.go:99`) |
| `PHARMACY-BND-001` | List default/oversize limit | P2 | catalog | `GET .../products` (no limit); then `limit=99999` | — | default 20; large limit accepted as given (note: no server cap — consider guard) |
| `PHARMACY-AUTHZ-001` | Unauthenticated blocked | P0 | no bearer | `GET .../products`, `GET .../cart` | — | 401 (`requireUserID`) |
| `PHARMACY-AUTHZ-002` | IDOR: user B cannot see/modify user A's cart | P0 | A has cart items | as B: `GET .../cart`; `PATCH .../cart/P`; `DELETE .../cart/P`; `DELETE .../cart` | — | B sees only own cart; A's items untouched (all queries filter `WHERE user_id=$B`) |
| `PHARMACY-INT-005` | Remove + clear cart | P2 | A has 2 items | `DELETE .../cart/P` then `DELETE .../cart` | — | 200; item removed; then cart empty |
| `PHARMACY-SEC-001` | Flag-off: routes not mounted | P0 | `FEATURE_PHARMACY_ENABLED` off | call any `/api/v1/pharmacy/*` route | — | not mounted / 404, never 500 — `../cross-cutting/feature-flags-and-audit.md` FLAG-SEC-001 |
| `PHARMACY-SEC-002` | Search input is parameterized (no SQLi) | P1 | catalog | `GET .../products?search=' OR 1=1--` | injection string | 200; treated as literal ILIKE pattern, no injection (args are bound `$n`) |

## 5. State-machine transitions

Not applicable — this module has no order/fulfilment lifecycle. (The clinical pharmacy order FSM
`CREATED→CONFIRMED→DISPENSED→…→CLOSED` / `CANCELLED→REFUNDED` lives in `../modules/health.md` §3.)

## 6. Security & abuse cases

- **IDOR / object-level (P0):** cart reads and mutations all filter by `user_id`
  (`PHARMACY-AUTHZ-002`). No cross-user cart access should be possible.
- **Auth required (P0):** every route is behind `requireUserID()` (`PHARMACY-AUTHZ-001`); see
  `../cross-cutting/authentication.md`.
- **Idempotency not enforced (P1 defect):** `PHARMACY-INT-004` — the stored key is decorative;
  add-to-cart replay double-counts. Low blast radius (no money), but fix before any checkout is
  wired onto this cart.
- **SQL injection (P1):** category/search are bound parameters (`$n`) — `PHARMACY-SEC-002`.
- **No stock/price re-check on cart:** the cart stores product_id only; price/stock are resolved
  at read time via join. If a checkout is ever added, server-side re-pricing must happen there,
  not from client-supplied amounts (see `../cross-cutting/money-invariants.md`).
- **Flag gating (P0):** `PHARMACY-SEC-001` → `../cross-cutting/feature-flags-and-audit.md`.
- **Money-invariant cases:** N/A for this module (no money mutation).

## 7. Automated specs to add

- `internal/pharmacy/service_test.go` — with a DB seam / pgxmock: owner-scoped cart (IDOR),
  in-stock-only listing, filter/search SQL shape, add-to-cart increment behavior (documents the
  non-idempotency defect until fixed).
- `internal/pharmacy/handler_idor_test.go` — gin `TestMode`: user B cannot read/patch/delete user
  A's cart (once a service seam exists).
- Add a server-side `limit` cap in `ListProducts` and a regression test (`PHARMACY-BND-001`).
  Follow the gin-`TestMode` boundary convention already in `handler_test.go`.

## 8. Coverage target & exit criteria

Tier 2 module — pure-logic floor ≥ 60%; the existing `handler_test.go` + `model_test.go` already
cover validation, auth-required, and kobo-integer. **Exit criteria:** `PHARMACY-AUTHZ-001/002`
(auth + IDOR) pass; `PHARMACY-VAL-001..003` (validation) pass; `PHARMACY-SEC-001` (flag-off)
passes. `PHARMACY-INT-004` (idempotency defect) tracked as a non-blocking defect while the module
has no money path.
