# Module: Loyalty (Membership Tiers + Paymax Black)

**Risk tier:** 1 &nbsp;·&nbsp; **Money-path:** no (points & perks are NEVER cash — NL-4/NL-5; partner settlement is billing reconciliation in kobo, never a member cash-out) &nbsp;·&nbsp; **Feature flag:** `FEATURE_LOYALTY_ENABLED`
**Code:** `backend/internal/loyalty/` — `handler.go`, `service.go`, `model.go`, `black.go`, `black_handler.go`, `invariants_test.go`. Mounted in `backend/internal/app/top5_p2_routes.go` (`RegisterLoyalty`) + `top5_p3_routes.go` (`RegisterLoyaltyBlack`): member on `finance.Group("/loyalty")` → `/api/finance/loyalty/*` and `/api/finance/loyalty/black/*`; admin on `adminGroupTop5(r, "/api/loyalty/admin")` / `.../black` with per-route RBAC (`loyalty.read`, `loyalty.black.manage`). Owns NO money primitive: awards go through `points.Earn`, redemptions through `points.Redeem`; Black perks mint a single-use `credential`.
**Slug:** `LOYALTY` (uppercase, used in Case IDs)

## 1. Overview & scope

Loyalty is the membership-tier engine over the points ledger plus the Phase-3 **Paymax Black** top tier. `AwardFor` (server-side only, NOT routed) translates a live-module trigger into an idempotent `points.Earn` under a config-bound rule, then re-evaluates the tier **monotonically** (no mid-period downgrade; `tierForTx` never returns below the current tier). `Redeem` gates a reward behind the member's tier (`rank(member) >= rank(MinTier)`), debits points via `points.Redeem` (NL-4 — no cash branch anywhere), and records a PENDING non-cash fulfilment. **Black** is the top tier ABOVE TIER3: enrolment/cancel are RBAC-gated admin actions, perks are redeemed via the shared single-use credential primitive at event gates (early tickets / lounge), and partner-offer settlement reconciles partner↔Paymax billing (never Paymax↔member cash — NL-5). Testing priorities: the `rank` comparator (drives monotonic tiering AND reward gating — a real BLACK-ordering bug was fixed here), earn/tier idempotency, the no-cash-out guarantee, Black eligibility fail-closed + monthly perk cap, and pervasive object-level isolation (a caller only ever reads/spends their own standing via the token `user_id`). Cross-cutting: `../cross-cutting/authentication.md`, `rbac-and-permissions.md`, `kyc-and-tiers.md`, `feature-flags-and-audit.md`. Points-ledger invariants live in `../modules/points.md` (loyalty owns no ledger).

## 2. Services / endpoints in scope

| Operation | Method + path (or service func) | Auth / permission | Money-path? |
|---|---|---|---|
| My membership | `GET /api/finance/loyalty/me` | member (token `user_id`) | no |
| Tier config | `GET /api/finance/loyalty/tiers` | member | no |
| Rewards catalog (tier-filtered) | `GET /api/finance/loyalty/rewards` | member (token `user_id`) | no |
| Redeem reward (non-cash) | `POST /api/finance/loyalty/redeem` `{sku}` | member (token `user_id`) | no (points debit only) |
| Admin read membership | `GET /api/loyalty/admin/memberships/:userId` | `RequirePermission("loyalty.read")` | no |
| Black: my standing | `GET /api/finance/loyalty/black/me` | member (token `user_id`) | no |
| Black: perks catalog | `GET /api/finance/loyalty/black/perks` | member | no |
| Black: redeem perk | `POST /api/finance/loyalty/black/redeem` `{perk_code, context_ref}` | member (token `user_id`); **active Black only** | no (mints credential) |
| Black: enroll | `POST /api/loyalty/admin/black/enroll` `{user_id, expires_at?}` | `loyalty.black.manage` | no |
| Black: cancel | `POST /api/loyalty/admin/black/cancel` `{user_id}` | `loyalty.black.manage` | no |
| Black: partner settlement | `POST /api/loyalty/admin/black/partner-settlement` `{partner_id, offer_id, amount_kobo}` | `loyalty.black.manage` | no (partner billing row) |
| Award points (server-side) | `Service.AwardFor(...)` — **not routed** | none exposed | no |
| Re-evaluate tier (server-side) | `Service.ReevaluateTier(...)` — internal | none exposed | no |

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| `rank` strict ordering TIER1<TIER2<TIER3 | unit | `internal/loyalty/invariants_test.go` (`TestRank_Ordering`) | AUTOMATED |
| Monotonic no-downgrade (`tierForTx` keep-cur guard) | unit | `invariants_test.go` (`TestRank_MonotonicNoDowngrade`) | AUTOMATED |
| MinTier reward gating (`rank(member) >= rank(MinTier)`) | unit | `invariants_test.go` (`TestRank_MinTierGating`) | AUTOMATED |
| `rank(BLACK)` is highest + non-Black fails a BLACK gate (fail-closed) | sec | `invariants_test.go` (`TestRank_BlackTierIsHighest`) | AUTOMATED |
| Unknown tier ranks 0 (never spoofs a high rank) | sec | `invariants_test.go` (`TestRank_UnknownTierIsZero`) | AUTOMATED |
| `AwardFor` idempotent (only `created` award bumps lifetime); tier promote in one tx | inv | — (needs live DB; DOC note in `invariants_test.go`) | TODO |
| `Redeem` MinTier gate + points debit + PENDING insert atomic; no double-burn on replay | int | — (DOC note) | TODO |
| Black enroll idempotent; cancel guarded ACTIVE→CANCELLED | int | — | TODO |
| Black perk fail-closed (non-active → `ErrNotBlack`) + monthly cap | sec | — | TODO |
| Member reads scoped to token `user_id` (no cross-member) | authz | — | TODO |
| Admin/Black-admin per-route RBAC | authz | — | TODO |
| Flag-off (loyalty disabled) → routes not mounted | sec | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `LOYALTY-INT-001` | Read my membership (auto-baseline) | P1 | member, no membership row | `GET /loyalty/me` | — | 200; creates/returns `TIER1`, `lifetime_points=0` |
| `LOYALTY-INT-002` | List tier config | P2 | active tiers seeded | `GET /loyalty/tiers` | — | 200; active tiers ordered by `threshold_points ASC` with benefits |
| `LOYALTY-INT-003` | Rewards catalog is tier-filtered | P1 | member TIER2, mix of TIER1/TIER3 rewards | `GET /loyalty/rewards` | — | only items with `rank(MinTier) <= rank(member)` returned, `cost_points ASC` |
| `LOYALTY-INT-004` | Redeem a perk (happy) | P1 | member tier ≥ item MinTier, points ≥ cost | `POST /loyalty/redeem {sku}` | perk kind, cost `200` | 200; points −`200` (via `points.Redeem`); `loyalty_redemptions` row `PENDING` |
| `LOYALTY-INT-005` | Tier promotes on earn (monotonic) | P0 | member near a threshold | server `AwardFor` crosses threshold | delta crosses TIER2 | tier → TIER2; `loyalty.tier.promote` audit; a later lower-delta re-eval never downgrades |
| `LOYALTY-INT-006` | Black enroll then view standing | P1 | admin grant | admin `POST /black/enroll {user_id}` then member `GET /black/me` | — | member ACTIVE; `is_black:true`; re-enroll is idempotent (`ON CONFLICT` → ACTIVE) |
| `LOYALTY-INT-007` | Black redeem credential perk | P1 | active Black member, credential perk | `POST /black/redeem {perk_code, context_ref}` | `redeem_via=credential` | 200; single-use credential minted + linked; `perk_redemptions` row; NL-5 (no cash) |
| `LOYALTY-INT-008` | Partner settlement recorded | P2 | admin | `POST /black/partner-settlement {partner_id, offer_id, amount_kobo}` | `amount_kobo=500000` | 200; `partner_settlements` PENDING; negative amount → 400 |
| `LOYALTY-INV-001` | Earn idempotent → no double tier count | P0 | same `(rule, reference)` replayed | invoke `AwardFor` twice | one reference | 2nd `created=false`; lifetime bumped once; tier counted once (NL-9) |
| `LOYALTY-INV-002` | Redeem insufficient points fails closed | P0 | balance `100`, cost `200` | `POST /loyalty/redeem {sku}` | `100 < 200` | error from `points.Redeem`; no redemption row; balance unchanged (see `../modules/points.md`) |
| `LOYALTY-SEC-001` | Tier gate blocks under-tier reward | P0 | member TIER1, reward MinTier TIER2 | `POST /loyalty/redeem {sku}` | rank 1 < 2 | 403 `ErrTierTooLow`; no points debit |
| `LOYALTY-SEC-002` | BLACK-gated reward closed to non-Black | P0 | member TIER3, reward MinTier BLACK | redeem / catalog | rank 3 < 4 | reward hidden in catalog + 403 on redeem (fixed `rank(BLACK)=4` bug; `TestRank_BlackTierIsHighest`) |
| `LOYALTY-SEC-003` | Black perk requires active membership | P0 | non-Black or expired Black member | `POST /black/redeem` | not active | 403 `ErrNotBlack` (fail-closed); no credential minted |
| `LOYALTY-SEC-004` | Monthly perk cap enforced | P1 | perk `max_per_month=1`, already used this month | `POST /black/redeem` | 2nd this month | 429 `ErrPerkCapReached`; no over-grant |
| `LOYALTY-SEC-005` | Inactive reward/perk rejected | P2 | item/perk `active=false` | redeem | inactive | 400 "inactive"; no debit/grant |
| `LOYALTY-SEC-006` | No public earn/award endpoint | P0 | — | attempt any award/credit route | — | 404 — earning is server-side `AwardFor` only; a client cannot self-promote |
| `LOYALTY-AUTHZ-001` | Reads scoped to token identity (IDOR) | P0 | members A + B | A calls `/loyalty/me`, `/rewards`, `/black/me` | — | only A's standing; identity is token `user_id`, never a body/query id |
| `LOYALTY-AUTHZ-002` | Admin membership read requires perm | P1 | caller lacking grant | `GET /loyalty/admin/memberships/:userId` | no `loyalty.read` | 403 (see `../cross-cutting/rbac-and-permissions.md`) |
| `LOYALTY-AUTHZ-003` | Black admin actions require `loyalty.black.manage` | P0 | caller lacking grant | enroll/cancel/partner-settlement | no grant | 403 |
| `LOYALTY-SEC-007` | Flag-off inaccessible | P0 | `FEATURE_LOYALTY_ENABLED=off` | call any `/loyalty/*` or `/loyalty/black/*` route | — | Route not mounted / 404 — never 500 (FLAG-SEC-001) |

## 5. State-machine transitions

No formal transition-map FSM in this module (contrast placement/business/top5events). What exists is not a per-request transition engine:

- **Membership tier** is a *monotonic promotion*, not a transition graph — `ReevaluateTier`/`tierForTx` bump `lifetime_points` and never return a tier below the current one (`rank(candidate) < rank(cur)` ⇒ keep cur). Assert monotonicity via `LOYALTY-INT-005` + `TestRank_MonotonicNoDowngrade`.
- **Black membership** has a single guarded status pair `ACTIVE → CANCELLED` (`Cancel` updates `WHERE state='ACTIVE'`; RowsAffected=0 ⇒ "not an active black member"). Enroll is idempotent (`ON CONFLICT (user_id) DO UPDATE … state='ACTIVE'`).
- **Redemption fulfilment** status (`PENDING → FULFILLED → FAILED`) is set by the owning fulfilment module (airtime/bill/ticket-discount), not by Loyalty — out of scope here.

## 6. Security & abuse cases

- **No cash-out (NL-4/NL-5):** points and Black perks never convert to cash — `Redeem` delegates to `points.Redeem` (which itself rejects cash/withdraw SKUs), and perks deliver access/content/discount only. Partner settlement reconciles partner billing (kobo-valued) and never credits a member wallet.
- **`rank` fail-closed comparator:** `LOYALTY-SEC-002` — the fixed `rank(BLACK)=4` (previously fell through to 0, which would have admitted every member to a BLACK gate) and `rank(unknown)=0` guarantee no tier value can spoof a high rank. This single comparator gates BOTH monotonic tiering and reward eligibility.
- **Earn tampering:** `LOYALTY-SEC-006` — there is no routed award endpoint; awards fire only server-side via `AwardFor` under a config-bound rule, and only a freshly-created (`created=true`) award contributes to lifetime points, so a replayed trigger cannot double-count toward a tier bump.
- **Black eligibility fail-closed:** `LOYALTY-SEC-003` — `isActiveBlack` requires an ACTIVE, unexpired row; any error or missing row denies. Monthly cap (`LOYALTY-SEC-004`) counts redemptions since `date_trunc('month', now())` and blocks over-grant.
- **IDOR:** `LOYALTY-AUTHZ-001` — member reads use the token `user_id` exclusively.
- **Audit:** tier promotes, redeems, enroll/cancel, and perk redemptions log via the nil-safe `Auditor` (AUDIT-SEC-001).
- Points-ledger invariants (projection, no-negative, earn/redeem idempotency, double-spend under concurrency) are owned by and asserted in `../modules/points.md`.

## 7. Automated specs to add

- `internal/loyalty/service_live_db_test.go` — live-DB (gated on `TEST_DATABASE_URL`): `AwardFor` idempotent + monotonic `ReevaluateTier` in one tx; `Redeem` MinTier gate + atomic points-debit + PENDING insert + no double-burn on replay (the DOC note in `invariants_test.go` enumerates exactly these). TODO.
- `internal/loyalty/black_live_db_test.go` — live-DB: enroll idempotent, cancel guarded ACTIVE→CANCELLED, `RedeemPerk` fail-closed (`ErrNotBlack`) + monthly cap (`ErrPerkCapReached`) + credential mint linkage; partner settlement PENDING insert + negative-amount rejection (`LOYALTY-INT-006/007/008`, `LOYALTY-SEC-003/004`). TODO.
- `internal/loyalty/authz_test.go` — token-scoped member reads (IDOR) + admin/Black-admin per-route RBAC (`LOYALTY-AUTHZ-001/002/003`). TODO.
- Route inventory assertion that no public award/credit route is mounted (`LOYALTY-SEC-006`), following the `router_parity_check_test.go` convention. TODO.

## 8. Coverage target & exit criteria

Tier-1 pure-logic floor ≥ 80% on the `rank` comparator + tier/gate logic (already strong via `invariants_test.go`). Exit criteria (release-ready): `LOYALTY-SEC-001/002/003/006` (tier gate, BLACK gate, Black fail-closed, no public earn), `LOYALTY-INV-001` (earn idempotent → single tier count), `LOYALTY-INT-005/007` (monotonic promote, Black credential perk), `LOYALTY-AUTHZ-001/003` (IDOR + Black-admin RBAC) all green; flag-off `LOYALTY-SEC-007` verified; no S1 open.
