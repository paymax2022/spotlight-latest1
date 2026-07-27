# Module: Groups

**Risk tier:** 0 &nbsp;·&nbsp; **Money-path:** yes (dues payments) &nbsp;·&nbsp; **Feature flag:** `FEATURE_GROUPS_ENABLED`
**Code:** `backend/internal/groups/` — `handler.go`, `service.go`, `model.go`, `model_test.go`. Routes mounted inline in `backend/internal/app/finance_routes.go` (`if cfg.FeatureGroupsEnabled`) under `finance.Group("/groups")` → `/api/finance/groups/*`.
**Slug:** `GROUPS` (uppercase, used in Case IDs)

## 1. Overview & scope

Groups are communities with their own **ledger wallet** and dues (subscription) payments. A creator becomes `owner`; roles are `owner > admin > member`. Only owner/admin may invite. `PayDues` looks up the group's subscription plan, then **debits the member's wallet and credits the group wallet** through the finance ledger (NL-8) keyed by a body-supplied `idempotency_key`. Testing priorities: the dues money move (conservation, idempotency, no overdraw), role-gated invite (authz), object-level access on group reads, and the money invariants in `../cross-cutting/money-invariants.md`. Also applies: `../cross-cutting/authentication.md`, `../cross-cutting/rbac-and-permissions.md` (role guards are service-layer here, not RBAC middleware), `../cross-cutting/kyc-and-tiers.md`, `../cross-cutting/feature-flags-and-audit.md`.

> Note: dues use `ledger.Debit` directly (not `wallet.Debit`), so tier-limit enforcement depends on the ledger path — a test gap worth flagging (see §6).

## 2. Services / endpoints in scope

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| Create group | `POST /api/finance/groups` `{name, description, is_public, avatar_url}` | member (creator = token `user_id`) | no |
| List my groups | `GET /api/finance/groups?limit=&offset=` | member (scoped to caller's memberships) | no |
| Get group | `GET /api/finance/groups/:id` | member | no |
| Invite member | `POST /api/finance/groups/:id/invite` `{user_id}` | member; **service guard: owner/admin only** | no |
| Pay dues | `POST /api/finance/groups/:id/dues` `{plan_id, idempotency_key}` | member (payer = token `user_id`) | **yes** |

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| Role model / request shape (owner/admin/member) | unit | `internal/groups/model_test.go` | AUTOMATED |
| Create group + owner membership + ledger account (tx atomic) | int | — | TODO |
| Invite role guard (owner/admin allow; member deny) | authz | — (guard in `assertRole`) | TODO |
| PayDues debit member / credit group wallet (conservation) | inv/int | — | TODO |
| PayDues idempotent on body `idempotency_key` (no double-charge) | inv/int | — | TODO |
| List scoped to caller's memberships (no cross-user leak) | authz | — | TODO |
| Flag-off route inaccessible | sec | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `GROUPS-INT-001` | Create group (happy) | P1 | member A | `POST /groups {name:"Alumni",is_public:true}` | name len ≥2 | 201; group returned; A is `owner`; a `group_wallet` ledger account exists; all in one tx |
| `GROUPS-INT-002` | Name validation | P1 | member A | `POST /groups {name:"x"}` | name len 1 (`min=2`) | 400 binding error; nothing created |
| `GROUPS-INT-003` | List returns only my groups | P1 | A in G1; B in G2 | A calls `GET /groups` | — | 200; only G1; member_count correct; ordered `created_at DESC` |
| `GROUPS-INT-004` | List pagination clamp | P2 | A in many groups | `GET /groups?limit=9999` | `limit>100` | 200; server clamps limit to 20 |
| `GROUPS-INT-005` | Get group by id | P2 | G1 exists | `GET /groups/:id` | valid id | 200 with member_count; missing id → 404 |
| `GROUPS-AUTHZ-001` | Owner can invite | P1 | A owner of G1 | `POST /groups/:id/invite {user_id:C}` | — | 200 `{ok:true}`; C added as `member` |
| `GROUPS-AUTHZ-002` | Admin can invite | P2 | D is admin of G1 | D invites E | — | 200; E added |
| `GROUPS-AUTHZ-003` | Plain member cannot invite | P0 | F is `member` of G1 | F invites G | member role | 403 "insufficient role"; no membership added (`assertRole`) |
| `GROUPS-AUTHZ-004` | Non-member cannot invite | P0 | H not in G1 | H invites anyone | not a member | 403 "member not found" |
| `GROUPS-INV-001` | Pay dues debit/credit conservation | P0 | member A in G1; plan `p1` = `500000` kobo; A funded | `POST /groups/:id/dues {plan_id:p1, idempotency_key:k1}` | `amount_kobo=500000` | 201 payment `status=paid`; A debited `500000`; group wallet credited `500000`; balanced (MONEY-INV-003) |
| `GROUPS-INV-002` | Pay dues idempotent replay | P0 | one paid dues, key `k1` | `POST .../dues` again with `k1` | same key + body | No second debit; payment not duplicated (MONEY-INV-006) |
| `GROUPS-INV-003` | Concurrent same-key dues → one | P0 | A funded | fire N concurrent dues with one key | N=10, `k1` | Exactly one debit; balance moves once (MONEY-INV-007) |
| `GROUPS-SEC-001` | Missing idempotency_key rejected | P0 | member A | `POST .../dues {plan_id:p1}` | no key | 400 (binding `required`); nothing posted (MONEY-INV-008) |
| `GROUPS-SEC-002` | Plan from another group rejected | P0 | plan `p2` belongs to G2 | A (in G1) pays with `plan_id=p2` | mismatched group | error "plan not found" (query pins `group_id=:id`); no debit — IDOR guard |
| `GROUPS-SEC-003` | Insufficient funds no overdraw | P0 | A balance `10000`, dues `500000` | `POST .../dues` | over-balance | Rejected by ledger; balance unchanged; no partial credit (MONEY-INV-005 / NL-1) |
| `GROUPS-INT-006` | Dues audit event | P1 | A pays dues | inspect audit sink | — | One audit event with actor + amount + idempotency ref (AUDIT-INT-001) |
| `GROUPS-SEC-004` | Flag-off inaccessible | P0 | `FEATURE_GROUPS_ENABLED=off` | call any `/groups*` route | — | Route not mounted / 404 — never 500 (FLAG-SEC-001) |

## 5. State-machine transitions (only if the module has an FSM)

No state machine in this module. `group_payments.status` is set to `paid` on a successful dues charge (the model documents `paid | pending | overdue` but the service only writes `paid`); there is no transition engine. Membership roles are static columns, not a lifecycle.

## 6. Security & abuse cases

- **IDOR on plan:** `GROUPS-SEC-002` — the plan lookup pins `group_id=:id`, so a member cannot pay a plan belonging to another group.
- **Role escalation:** `GROUPS-AUTHZ-003/004` — invite is guarded by `assertRole(owner, admin)`; a member/non-member is denied.
- **Idempotency:** `GROUPS-SEC-001` — key is mandatory (body, not header — note the deviation from the header convention used elsewhere).
- **Overdraw / no-advance:** `GROUPS-SEC-003` — ledger debit must reject insufficient balance (NL-1).
- **Tier-limit gap:** dues call `ledger.Debit` directly rather than `wallet.Debit`, so confirm tier-limit enforcement still applies on this path; if not, that is an S2 finding. See `../cross-cutting/kyc-and-tiers.md`.
- **Audit actor identity:** payer/creator identity is the token `user_id`, never a body field (AUDIT-SEC-001).
- Inherit `../cross-cutting/money-invariants.md` (I1–I12) substituting `POST /groups/:id/dues`.

## 7. Automated specs to add

- `internal/groups/service_test.go` — `assertRole` allow/deny matrix (owner/admin/member/non-member) table-driven. TODO.
- `internal/groups/dues_live_db_test.go` — live-DB: dues debit/credit conservation, idempotent replay, concurrent-same-key, cross-group plan rejection, insufficient-funds no-overdraw. TODO.
- `internal/groups/create_tx_test.go` — create rolls back group + owner-membership + ledger account together on any failure (atomicity). TODO.

## 8. Coverage target & exit criteria

Tier-0 pure-logic floor ≥ 85% on role guard + dues math. Exit criteria: `GROUPS-INV-001/002/003` (conservation, replay, concurrency), `GROUPS-SEC-001/002/003` (key, IDOR, overdraw), `GROUPS-AUTHZ-003` (role guard) all green; flag-off `GROUPS-SEC-004` verified; tier-limit path on `ledger.Debit` confirmed or filed as a defect; no S1 open.
