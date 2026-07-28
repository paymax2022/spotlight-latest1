# Module: Spotlight Wealth

**Risk tier:** 0 &nbsp;·&nbsp; **Money-path:** yes (single reward-payout path) &nbsp;·&nbsp; **Feature flag:** `FEATURE_SPOTLIGHTWEALTH_ENABLED` (default off)
**Code:** `backend/internal/spotlightwealth/` — `routes.go`, `handler.go`, `service.go`, `admin.go`, `model.go` (no `*_test.go`). Mounted at `backend/internal/app/router.go:374-376` via `RegisterSpotlightwealthRoutes` (`spotlightwealth_routes.go`).
**Slug:** `SPOTLIGHTWEALTH`

## 1. Overview & scope

Spotlight Wealth surfaces reward-earning "challenges", videos, campaigns, a leaderboard, and a reward wallet under `/api/v1/spotlight`. Despite the "wealth/portfolio" framing there is **exactly one money-moving path**: challenge completion pays a wallet **credit** funded from the `paymax_revenue` standing account (a redistribution, never minted). There is no deposit/invest/withdraw/redeem. Member routes require `RequireAuthContext`; admin CRUD requires `spotlight.admin.manage`. There is **no tier or KYC gate**. Money is stored as BIGINT kobo (`amount_kobo`), converted to a float `Money{Amount, Currency}` only at the handler boundary for display. Reward-wallet balance is derived as `SUM(amount_kobo)` — never a mutated column. **Critical wiring fact for testing:** both services are constructed with a **nil audit sink** (`NewService(pool, ledgerSvc, nil)`, `NewAdminService(pool, nil)`), and `log()` returns early when audit is nil — so in the wired path **no audit events are emitted**; this is a real audit-coverage gap to verify/flag. Applies: `../cross-cutting/money-invariants.md`, `authentication.md`, `rbac-and-permissions.md`, `feature-flags-and-audit.md`.

## 2. Services / endpoints in scope

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| List videos | `GET /api/v1/spotlight/videos` | auth | no |
| List / get challenge | `GET /challenges`, `/challenges/:id` | auth | no |
| Join challenge | `POST /challenges/:id/join` | auth + user_id | no |
| Complete challenge (reward) | `POST /challenges/:id/complete` | auth + user_id + Idempotency-Key | yes |
| Leaderboard | `GET /leaderboard` | auth | no |
| Reward wallet | `GET /reward-wallet` | auth + user_id | no |
| List / get campaign | `GET /campaigns`, `/campaigns/:id` | auth | no |
| Admin: videos CRUD | `POST/PUT/DELETE /admin/videos[/:id]` | `spotlight.admin.manage` | no |
| Admin: challenges CRUD | `POST/PUT/DELETE /admin/challenges[/:id]` | `spotlight.admin.manage` | no (config) |
| Admin: campaigns CRUD | `POST/PUT/DELETE /admin/campaigns[/:id]` | `spotlight.admin.manage` | no |

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| Reward credit funded from revenue, once per first completion | inv/int | — (no `*_test.go`) | TODO |
| Idempotent completion replay (no double reward) | inv/int | — | TODO |
| Join→Complete state guard | fsm | — | TODO |
| Complete-without-join rejected | authz | — | TODO |
| Reward-wallet balance == SUM(entries) | inv | — | TODO |
| Reward negative amount validation | val | — | TODO |
| Admin CRUD RBAC | authz | — | TODO |
| Audit events emitted (currently nil sink) | int | — | TODO (expected FAIL — flag) |
| Flag-off route not mounted | sec | — | TODO |

Entire module is untested.

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `SPOTLIGHTWEALTH-INT-001` | First completion pays reward | P0 | user joined a published challenge with `reward_kobo>0` | `POST /challenges/:id/complete` w/ Idempotency-Key | `reward_kobo:50000` | Member `JOINED→COMPLETED`; wallet credited `50000` from `paymax_revenue`; reward ledger row inserted (`amount_kobo=50000`) |
| `SPOTLIGHTWEALTH-INT-002` | Zero-reward challenge: no payout | P1 | joined, `reward_kobo=0` | complete | `reward_kobo:0` | State→COMPLETED; no ledger post; wallet unchanged |
| `SPOTLIGHTWEALTH-INT-003` | Reward-wallet balance is derived | P1 | user with reward entries | `GET /reward-wallet` | — | Balance == `SUM(amount_kobo)`; kobo-exact; no cached column |
| `SPOTLIGHTWEALTH-INT-004` | Join is idempotent enrol | P2 | published, not ended | `POST /challenges/:id/join` twice | — | Second is no-op (`ON CONFLICT DO NOTHING`); single membership row `JOINED` |
| `SPOTLIGHTWEALTH-VAL-001` | Complete without join rejected | P0 | never joined | `POST /challenges/:id/complete` | valid idem key | `ErrForbidden` (403); no state, no payout |
| `SPOTLIGHTWEALTH-VAL-002` | Complete missing Idempotency-Key | P0 | joined | complete, no header | — | 400 (`ErrBadInput`); nothing posted. MONEY-INV-008 |
| `SPOTLIGHTWEALTH-VAL-003` | Join a challenge that has ended | P1 | challenge `ends_at < now` | `POST /join` | ended | `ErrChallengeEnded`; no membership |
| `SPOTLIGHTWEALTH-VAL-004` | Complete unpublished/missing challenge | P1 | challenge unpublished | complete | — | `ErrNotFound` (404) |
| `SPOTLIGHTWEALTH-VAL-005` | Admin create negative reward rejected | P1 | admin | `POST /admin/challenges` | `reward_kobo:-1` | `ErrBadInput`; not created |
| `SPOTLIGHTWEALTH-AUTHZ-001` | Unauthenticated rejected | P0 | no token | `GET /reward-wallet` | — | 401 |
| `SPOTLIGHTWEALTH-AUTHZ-002` | Non-admin cannot CRUD | P0 | user w/o `spotlight.admin.manage` | `POST /admin/challenges` | — | 403 |
| `SPOTLIGHTWEALTH-AUTHZ-003` | Reward wallet scoped to caller | P0 | users A and B have rewards | `GET /reward-wallet` as A | — | Only A's entries; no cross-user leak |
| `SPOTLIGHTWEALTH-INV-001` | Idempotent completion replay | P0 | joined | complete twice, **same** Idempotency-Key | same key | `RowsAffected==0` on 2nd; single reward; balance moved once (MONEY-INV-006) |
| `SPOTLIGHTWEALTH-INV-002` | Concurrent same-key completion → one reward | P0 | joined | N=10 concurrent completes, one key | one key | Exactly one reward credited (MONEY-INV-007) |
| `SPOTLIGHTWEALTH-INV-003` | Same header across two challenges | P1 | joined to challenges X and Y | complete both reusing one Idempotency-Key | header suffixed `:wallet`/`:reward` only, not by challenge id | Verify both rewards post correctly (or document collision risk) — targeted per inventory note |
| `SPOTLIGHTWEALTH-SEC-001` | Flag off → routes not mounted | P0 | `FEATURE_SPOTLIGHTWEALTH_ENABLED=false` | call any `/api/v1/spotlight/*` | — | Not mounted / 404. FLAG-SEC-001 |
| `SPOTLIGHTWEALTH-SEC-002` | Audit event on reward payout | P1 | wired production path | complete a challenge; inspect audit sink | — | **Expected gap:** audit sink is nil → no event emitted. Flag against AUDIT-INT-001 until a real sink is wired |
| `SPOTLIGHTWEALTH-SEC-003` | Reward never minted (conservation) | P0 | — | complete N challenges | — | Every reward debits `paymax_revenue`; ledger balanced; no value created out of nothing (MONEY-INV-003) |

## 5. State-machine transitions

Challenge membership (`spotlight_challenge_members.state`).

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| (none) | join | JOINED | enrol row inserted (idempotent) | `SPOTLIGHTWEALTH-FSM-001` |
| JOINED | complete (first) | COMPLETED | reward credited if `reward_kobo>0` | `SPOTLIGHTWEALTH-FSM-002` |
| (none) | complete | (rejected) | `ErrForbidden` — must join first | `SPOTLIGHTWEALTH-FSM-003` |
| COMPLETED | complete again | COMPLETED | no-op; `RowsAffected==0`; no second reward | `SPOTLIGHTWEALTH-FSM-004` |

No PENDING/EXPIRED/CANCELLED states exist; there is no reverse transition from COMPLETED.

## 6. Security & abuse cases

- Idempotency/replay/concurrency: `SPOTLIGHTWEALTH-INV-001..003`; reference `../cross-cutting/money-invariants.md`.
- Authz/scoping: `SPOTLIGHTWEALTH-AUTHZ-001..003`; reference `../cross-cutting/rbac-and-permissions.md`.
- Conservation: `SPOTLIGHTWEALTH-SEC-003` — reward is redistributed from `paymax_revenue`, never minted.
- **Audit gap:** `SPOTLIGHTWEALTH-SEC-002` — services wired with nil auditor; no events emitted in production path. Reference `../cross-cutting/feature-flags-and-audit.md` AUDIT-INT-001; track as a defect until a sink is injected.
- Display float: `koboToMoney` divides by 100.0 at the boundary — assert display rounding never feeds back into stored math (stored values stay integer kobo).

## 7. Automated specs to add

- `internal/spotlightwealth/service_int_test.go` (live-DB) — first-completion reward from `paymax_revenue`, idempotent replay (single reward), concurrent same-key, `JOINED→COMPLETED` guard, complete-without-join rejection, zero-reward no-op, derived balance == `SUM(amount_kobo)`.
- `internal/spotlightwealth/admin_test.go` — RBAC (`spotlight.admin.manage`), negative `reward_kobo` rejection on create/update.
- `internal/spotlightwealth/audit_test.go` — assert an audit event IS emitted per money mutation once a real sink is wired (currently would fail — nil sink).
- Flag-off route-mount assertion (`SPOTLIGHTWEALTH-SEC-001`).

## 8. Coverage target & exit criteria

Tier-0 floor ≥ 85% on the reward path. **Exit criteria (release-blocking):** `SPOTLIGHTWEALTH-INT-001`, `SPOTLIGHTWEALTH-VAL-001..002`, `SPOTLIGHTWEALTH-INV-001..002`, `SPOTLIGHTWEALTH-AUTHZ-001..003`, `SPOTLIGHTWEALTH-SEC-001/003` green. The nil-audit-sink gap (`SPOTLIGHTWEALTH-SEC-002`) must be resolved or explicitly risk-accepted before go-live, since a money mutation currently writes no audit trail.
