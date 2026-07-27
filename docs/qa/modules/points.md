# Module: Points

**Risk tier:** 2 &nbsp;·&nbsp; **Money-path:** no (points are NOT cash — NL-4) &nbsp;·&nbsp; **Feature flag:** `FEATURE_LOYALTY_ENABLED` (Points has no flag of its own — it is mounted by `RegisterLoyalty`, so it inherits the loyalty flag)
**Code:** `backend/internal/points/` — `handler.go`, `service.go`, `model.go`. Mounted in `backend/internal/app/top5_p2_routes.go` (`RegisterLoyalty`) under `finance.Group("/loyalty")` → member routes at `/api/finance/points/*`. No in-package `*_test.go`.
**Slug:** `POINTS` (uppercase, used in Case IDs)

## 1. Overview & scope

Points is a member-facing, **read-mostly** loyalty ledger. It exposes only balance, history, catalog, and non-cash redemption. The hard invariant (NL-4) is that **points are never cash**: there is no endpoint that credits a wallet from a points balance, and `Redeem` refuses any catalog item whose `kind` is `cash` or contains `withdraw`. Earning is **never a public endpoint** — points accrue only as a side effect of live-module actions via the loyalty layer (`Service.Earn`, called server-side from `loyalty.AwardFor`), so a client can never self-award. The balance is a **projection of the append-only `points_ledger`** (EARN − REDEEM − EXPIRE over non-expired rows), never a stored column. Testing priorities: the no-cash-out guarantee, object-level isolation (a caller only ever reads/spends their own points via the token `user_id`), redemption balance-guard + idempotency, and earn idempotency (exercised indirectly). Cross-cutting: `../cross-cutting/authentication.md`, `../cross-cutting/rbac-and-permissions.md`, `../cross-cutting/feature-flags-and-audit.md`.

## 2. Services / endpoints in scope

| Operation | Method + path (or service func) | Auth / permission | Money-path? |
|---|---|---|---|
| Read balance | `GET /api/finance/points/balance` | member (token `user_id`) | no |
| Read history | `GET /api/finance/points/history?limit=` | member (token `user_id`) | no |
| List catalog | `GET /api/finance/points/catalog` | member (any authed) | no |
| Redeem item (non-cash) | `POST /api/finance/points/redeem` `{sku}` | member (token `user_id`) | no (points debit only) |
| Earn (award) | `Service.Earn(...)` — **server-side only, NOT routed** | none exposed | no |
| Expire due | `Service.ExpireDue(...)` — scheduler/server-side only | none exposed | no |

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| Balance = projection of ledger (EARN − REDEEM − EXPIRE, non-expired only) | inv | — | TODO |
| Earn idempotent on `(ruleKey+version+reference)`; replay → `created=false`, no double-award | inv | — | TODO |
| Redeem balance-guard under `FOR UPDATE`; insufficient → `ErrInsufficientPoints` (402) | int | — | TODO |
| Cash/withdraw catalog item rejected (`ErrCashRedemptionForbidden`, 403) | sec | — | TODO |
| History/balance scoped to token `user_id` (no cross-member read) | authz | — | TODO |
| No public earn/credit endpoint exists | con | `router_parity_check_test.go` (route inventory, indirect) | PARTIAL |
| Flag-off (loyalty disabled) → points routes not mounted | sec | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `POINTS-INT-001` | Read own balance | P1 | member with earned points | `GET /points/balance` | — | 200 `{success, balance_points}`; equals ledger projection |
| `POINTS-INT-002` | Read own history newest-first | P2 | member with ≥3 ledger rows | `GET /points/history?limit=2` | `limit=2` | 200; exactly 2 rows, `created_at DESC`; each row is own `user_id` |
| `POINTS-INT-003` | History limit clamp | P2 | member | `GET /points/history?limit=9999` | `limit=9999` | 200; server clamps to 50 (limit>200 ⇒ default 50) |
| `POINTS-INT-004` | List active catalog | P2 | ≥1 active + 1 inactive item | `GET /points/catalog` | — | 200; only `active=true` items, ordered `cost_points ASC` |
| `POINTS-INT-005` | Redeem a perk (happy) | P1 | balance ≥ item cost; item kind `perk` | `POST /points/redeem {sku}` | balance `500`, cost `200` | 200; REDEEM row appended (points, not kobo); balance now `300`; redemption status `REDEEMED` |
| `POINTS-INV-001` | Balance is projection, never stored | P0 | seeded EARN + REDEEM + expired EARN | recompute balance from `points_ledger` | expired EARN excluded | balance == SUM(EARN non-expired) − REDEEM − EXPIRE; never negative (floored at 0) |
| `POINTS-INV-002` | Earn idempotent (indirect) | P0 | same `(ruleKey, reference)` twice | invoke `Earn` twice (via loyalty award) | one reference | 2nd call `created=false`; single ledger row; award counted once |
| `POINTS-INV-003` | Redeem insufficient points | P0 | balance `100`, item cost `200` | `POST /points/redeem {sku}` | `100 < 200` | 402 `ErrInsufficientPoints`; no REDEEM row; balance unchanged `100` |
| `POINTS-INV-004` | Redeem concurrency (double-spend guard) | P0 | balance exactly one item's cost | fire 2 concurrent redeems of same sku | balance `200`, cost `200` | Exactly one succeeds (row locked `FOR UPDATE`); other → 402; balance ends `0`, one redemption |
| `POINTS-SEC-001` | Cash redemption forbidden | P0 | catalog item `kind=cash` (misconfig) | `POST /points/redeem {sku}` | kind `cash` / `*withdraw*` | 403 `ErrCashRedemptionForbidden`; NL-4 upheld; no debit |
| `POINTS-SEC-002` | No public earn endpoint | P0 | — | attempt `POST /points/earn` / any credit route | — | 404 (route does not exist); earning is server-side only |
| `POINTS-SEC-003` | Redeem inactive item | P1 | item `active=false` | `POST /points/redeem {sku}` | inactive sku | 400 (`item inactive`); no debit |
| `POINTS-SEC-004` | Missing `sku` | P2 | member | `POST /points/redeem {}` | empty body | 400 (binding required) |
| `POINTS-AUTHZ-001` | Balance requires auth | P0 | no session | `GET /points/balance` with no token | — | 401 `unauthenticated` |
| `POINTS-AUTHZ-002` | Cannot read another member's points (IDOR) | P0 | member A + B | A calls balance/history | — | Only A's rows returned; identity is token `user_id`, never a body/query param |
| `POINTS-SEC-005` | Flag-off inaccessible | P0 | `FEATURE_LOYALTY_ENABLED=off` | call any `/points/*` route | — | Route not mounted / 404 — never 500. See `../cross-cutting/feature-flags-and-audit.md` (FLAG-SEC-001) |

## 5. State-machine transitions (only if the module has an FSM)

No state machine in this module. `points_ledger` is an append-only journal with typed rows (EARN / REDEEM / EXPIRE / ADJUST); there is no lifecycle FSM. Redemption status (`REDEEMED → FULFILLED → FAILED`) is set by the owning fulfilment module (loyalty layer), not by Points.

## 6. Security & abuse cases

- **No cash-out (NL-4):** `POINTS-SEC-001` — the defence-in-depth check in `Redeem` blocks any `cash`/`*withdraw*` item even if a catalog row is misconfigured. This is the module's headline invariant.
- **Earn tampering:** `POINTS-SEC-002` — there is no public earn route; a client cannot inject an award. Award amount is server-derived from the active `EarnRule` version, not client input.
- **IDOR:** `POINTS-AUTHZ-002` — balance/history use the token `user_id` exclusively.
- **Double-spend under concurrency:** `POINTS-INV-004` — the `FOR UPDATE` balance read serialises redemptions.
- **Audit actor identity:** money-adjacent admin `ADJUST` corrections and `redeem`/`earn` calls log via the nil-safe `Auditor`; see `../cross-cutting/feature-flags-and-audit.md` (AUDIT-SEC-001).

## 7. Automated specs to add

- `internal/points/service_test.go` — table-driven pure tests for `Balance` projection math (expiry exclusion, floor-at-zero) using a mock/stub pool seam, plus `Earn` award computation (`PointsFixed` + `PointsPerKobo*AmountKobo`). Follows table-driven Go convention. TODO.
- `internal/points/redeem_live_db_test.go` — live-DB (gated on `TEST_DATABASE_URL`): redeem balance-guard, concurrent double-spend (`POINTS-INV-004`), cash-item rejection, insufficient-balance. TODO.
- `internal/points/earn_idempotency_test.go` — replay of `(ruleKey+version+reference)` returns `created=false` and adds no row (`POINTS-INV-002`). TODO.
- Contract assertion in `router_parity_check_test.go` (or a new `points_routes_test.go`) that no earn/credit route is mounted (`POINTS-SEC-002`). TODO.

## 8. Coverage target & exit criteria

Tier 2 pure-logic floor ≥ 70% on `Balance`/`Earn` computation. Exit criteria (release-ready): `POINTS-SEC-001` (no cash-out), `POINTS-SEC-002` (no public earn), `POINTS-INV-003`/`POINTS-INV-004` (redeem guard + concurrency), and `POINTS-AUTHZ-001`/`002` (auth + IDOR) all green; flag-off case `POINTS-SEC-005` verified.
