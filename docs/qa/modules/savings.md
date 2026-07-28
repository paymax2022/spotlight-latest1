# Module: Savings (Vaults · Circles/Ajo · Targets)

**Risk tier:** 0 &nbsp;·&nbsp; **Money-path:** yes &nbsp;·&nbsp; **Feature flag:** `FEATURE_SAVINGS_ENABLED` (default off)
**Code:** `backend/internal/savings/` — `handler.go`, `vault_service.go`, `ajo_service.go`, `target_service.go`, `member_reads.go`, `model.go`, `invariants_test.go`. Mounted at `backend/internal/app/finance_routes.go:427-429`; admin group in `top5_admin_group.go`; wiring in `top5_p1_routes.go`.
**Slug:** `SAVINGS`

## 1. Overview & scope

Savings is a Tier-0 money-path module spanning three sub-products: **Vaults** (personal deposit/withdraw/early-withdraw/autosave), **Circles** (Ajo/Esusu rotating pools: discover/join/activate/contribute/make-good), and **Targets** (group goals: join/contribute/approve/release). All money is integer kobo moved via `ledger.Debit`/`ledger.Credit` (wallet↔escrow), with derived balances (never mutated columns). Member routes inherit `RequireAuthContext` + `requireUserID()` from the finance group; there is **no per-route RBAC** on member routes and **no tier/KYC gate anywhere** in the module (a fact of absence to flag). Object-level authZ (owner/member/creator) is enforced only in the service layer. Idempotency-Key is required on all money mutations except autosave-enable/join/approve/create. **Known QA-relevant gaps from code:** (1) auditor is wired as **nil** (`top5_p1_routes.go:46`) so audit events currently no-op; (2) `VaultBalance` and `TargetBalance` handlers do **no owner/member check** — any authenticated user can read any balance; (3) early-withdraw `penalty_bps` is **client-supplied** with only a 0–10000 range check (no minimum) so a locked vault can be broken penalty-free. Applies: `../cross-cutting/money-invariants.md`, `authentication.md`, `rbac-and-permissions.md`, `feature-flags-and-audit.md`. (KYC/tiers referenced only to assert the gap.)

## 2. Services / endpoints in scope

### (a) Vaults

| Operation | Method + path | Guard | Money-path? |
|---|---|---|---|
| Create vault | `POST /api/finance/savings/vaults` | owner from session | no |
| List / get vault | `GET /vaults`, `/vaults/:id` | owner filter / owner check | no |
| Vault balance | `GET /vaults/:id/balance` | **no owner check (gap)** | no |
| Deposit | `POST /vaults/:id/deposit` | Idempotency-Key + owner + state OPEN | yes |
| Withdraw | `POST /vaults/:id/withdraw` | Idempotency-Key + owner + balance | yes |
| Early withdraw | `POST /vaults/:id/early-withdraw` | Idempotency-Key + owner + penalty | yes |
| Enable autosave | `POST /vaults/:id/autosave` | owner (no idem key) | no |

### (b) Circles (Ajo/Esusu)

| Operation | Method + path | Guard | Money-path? |
|---|---|---|---|
| List circles | `GET /circles` | membership filter | no |
| Discover | `GET /circles/discover` | public, FORMING only, no PII | no |
| Create | `POST /circles` | — | no |
| Join | `POST /circles/:id/join` | FORMING only + dup-guard | no |
| Activate | `POST /circles/:id/activate` | **creator only**, ≥2 members | no |
| Get circle | `GET /circles/:id` | **member-only** | no |
| Contribute | `POST /circles/:id/contribute` | Idempotency-Key + member + ACTIVE | yes |
| Make-good | `POST /circles/:id/make-good` | Idempotency-Key | yes |
| Admin get circle | `GET /api/savings/admin/circles/:id` | RBAC `savings.admin.view` | no |

### (c) Targets

| Operation | Method + path | Guard | Money-path? |
|---|---|---|---|
| List targets | `GET /targets` | membership filter | no |
| Create | `POST /targets` | — | no |
| Get target | `GET /targets/:id` | **member-only** | no |
| Join | `POST /targets/:id/join` | OPEN only + dup-guard | no |
| Contribute | `POST /targets/:id/contribute` | Idempotency-Key + member + OPEN/REACHED | yes |
| Approve | `POST /targets/:id/approve` | member check | no |
| Release | `POST /targets/:id/release` | Idempotency-Key + **creator only** + rule met | yes |
| Target balance | `GET /targets/:id/balance` | **no member check (gap)** | no |
| Summary | `GET /summary` | caller-scoped | no |

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| Vault FSM legal/illegal | fsm | `internal/savings/invariants_test.go` `TestVaultFSM` | AUTOMATED |
| Circle FSM legal/illegal | fsm | `invariants_test.go` `TestCircleFSM` | AUTOMATED |
| Member FSM (incl. make-good restore) | fsm | `invariants_test.go` `TestMemberFSM` | AUTOMATED |
| Target FSM legal/illegal | fsm | `invariants_test.go` `TestTargetFSM` | AUTOMATED |
| Release majority threshold (strict) | unit | `invariants_test.go` `TestMajorityThreshold` | AUTOMATED |
| Ajo payout conservation (no top-up) | inv | `invariants_test.go` `TestAjoPayoutConservation` | AUTOMATED |
| Derived balance == SUM(entries) | inv/int | — (live-DB, noted in test doc footer) | TODO |
| Contribute idempotency/replay | inv/int | — | TODO |
| Ajo RunCycle end-to-end escrow legs | int | — | TODO |
| Make-good own-wallet funding | int | — | TODO |
| Early-withdraw penalty calc + routing | inv/int | — | TODO |
| Owner/member authZ + IDOR on balances | authz | — | TODO |
| Audit events (nil sink) | int | — | TODO (expected FAIL — flag) |
| Flag-off route not mounted | sec | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `SAVINGS-INT-001` | Vault deposit posts wallet→escrow→vault credit | P0 | OPEN vault, wallet funded | `POST /vaults/:id/deposit` w/ idem key | `amount_kobo:100000` | Wallet debited; vault ledger credited `100000`; derived balance +100000; kobo-exact |
| `SAVINGS-INT-002` | Vault withdraw returns escrow→wallet | P0 | vault balance ≥ amount | `POST /vaults/:id/withdraw` w/ idem key | `amount_kobo:50000` | Vault debited; wallet credited `50000`; balance -50000 |
| `SAVINGS-INT-003` | Early withdraw on locked vault applies penalty | P0 | LOCK vault, OPEN, not matured | `POST /vaults/:id/early-withdraw` w/ idem key | `{amount_kobo:100000, penalty_bps:500}` | Vault debited `100000`; wallet credited full `100000`; then `penalty = 100000·500/10000 = 5000` debited wallet→`paymax_revenue`; returns `(newBalance, 5000)`; commission recorded |
| `SAVINGS-INT-004` | Early withdraw on FLEX/matured = no penalty | P1 | FLEX or matured vault | early-withdraw | `penalty_bps:500` | Penalty=0 (behaves as normal withdraw) |
| `SAVINGS-INT-005` | Target contribute credits group ledger, flips REACHED at goal | P0 | member of OPEN target | `POST /targets/:id/contribute` w/ idem key | `amount_kobo` reaching `target_kobo` | Wallet→escrow + group_target_ledger credit; state OPEN→REACHED at goal |
| `SAVINGS-INT-006` | Target release drains to creator on majority | P0 | REACHED target, majority approvals, caller=creator | `POST /targets/:id/release` w/ idem key | — | State→RELEASED; ledger drained; escrow→creator wallet credit |
| `SAVINGS-INT-007` | Ajo cycle pays recipient full collected pot | P0 | ACTIVE circle, members contribute | run cycle | contribution × payers | Per-member debit→escrow; single credit to recipient == collected; no Paymax top-up |
| `SAVINGS-INT-008` | Ajo make-good restores DEFAULTED member | P1 | member DEFAULTED | `POST /circles/:id/make-good` w/ idem key | `{cycle_number}` | Member DEFAULTED→ACTIVE; own-wallet funds the missed contribution |
| `SAVINGS-VAL-001` | Withdraw more than balance | P0 | balance < amount | withdraw | `amount_kobo > balance` | `ErrInsufficientVault`; balance unchanged |
| `SAVINGS-VAL-002` | Missing Idempotency-Key on money op | P0 | any money endpoint | POST with no header | — | 400 (`requireIdem`). MONEY-INV-008 |
| `SAVINGS-VAL-003` | Float/string amount rejected | P0 | OPEN vault | deposit `amount_kobo:"1000"` / `1000.5` | — | 400. MONEY-INV-002 |
| `SAVINGS-VAL-004` | Deposit into non-OPEN vault | P1 | vault MATURED/CLOSED | deposit | — | Rejected (state guard) |
| `SAVINGS-VAL-005` | Contribute to non-ACTIVE circle | P1 | circle FORMING/COMPLETED | contribute | — | Rejected (state guard) |
| `SAVINGS-VAL-006` | penalty_bps out of range | P1 | locked vault | early-withdraw `penalty_bps:10001` | — | Error (range 0–10000) |
| `SAVINGS-AUTHZ-001` | Unauthenticated rejected | P0 | no token | any route | — | 401 (`requireUserID`) |
| `SAVINGS-AUTHZ-002` | Read another user's vault (owner check) | P0 | vault owned by B | `GET /vaults/:id` as A | B's id | `ErrForbidden` (403) |
| `SAVINGS-AUTHZ-003` | IDOR: read any vault/target balance | P0 | vault/target owned by B | `GET /vaults/:id/balance`, `/targets/:id/balance` as A | B's id | **Expected gap:** handlers do no owner/member check — flag as IDOR defect; assert intended behavior is 403 |
| `SAVINGS-AUTHZ-004` | Non-member cannot read circle/target | P0 | not a member | `GET /circles/:id`, `/targets/:id` | — | 403 (member-only check) |
| `SAVINGS-AUTHZ-005` | Activate circle by non-creator | P0 | member, not creator | `POST /circles/:id/activate` | — | `ErrForbidden` (creator-only) |
| `SAVINGS-AUTHZ-006` | Release target by non-creator | P0 | member, not creator | `POST /targets/:id/release` | — | `ErrForbidden` (creator-only) |
| `SAVINGS-AUTHZ-007` | Admin circle read needs RBAC | P1 | user w/o `savings.admin.view` | `GET /api/savings/admin/circles/:id` | — | 403 |
| `SAVINGS-INV-001` | Idempotent contribute replay | P0 | member of ACTIVE circle/OPEN target | contribute twice, same idem key | same key | Single ledger post (`ON CONFLICT DO NOTHING`); balance moves once (MONEY-INV-006) |
| `SAVINGS-INV-002` | Concurrent same-key deposit → one | P0 | OPEN vault | N=10 concurrent deposits, one key | one key | Exactly one posts (MONEY-INV-007) |
| `SAVINGS-INV-003` | Derived balance == SUM(entries) | P0 | vault with entries | post several; recompute | — | Balance == SUM(amount_kobo); no cached-column drift (MONEY-INV-004) |
| `SAVINGS-INV-004` | No yield/interest entries | P1 | vault | attempt to append entry reason "interest"/"yield" | — | Rejected (`appendVaultEntry` NL-2) |
| `SAVINGS-SEC-001` | Flag off → routes not mounted | P0 | `FEATURE_SAVINGS_ENABLED=false` | call any `/api/finance/savings/*` | — | Not mounted / 404. FLAG-SEC-001 |
| `SAVINGS-SEC-002` | Locked vault broken penalty-free | P0 | LOCK vault, OPEN, not matured | early-withdraw `penalty_bps:0` | 0 | **Expected gap:** current code accepts 0 (no server-side minimum) → penalty-free break. Flag as defect; assert server enforces a minimum penalty for locked vaults |
| `SAVINGS-SEC-003` | Audit event on money mutation | P1 | wired path | deposit; inspect audit sink | — | **Expected gap:** auditor is nil (`top5_p1_routes.go:46`) → no event. Flag against AUDIT-INT-001 until a sink is wired |
| `SAVINGS-SEC-004` | Ajo default: pot reduced, never topped up | P0 | member with insufficient wallet | run cycle | — | Member marked DEFAULTED; recipient gets `collected` minus the defaulter's share; Paymax never covers the gap (conservation) |

## 5. State-machine transitions

Defined in `model.go`; checkers `canVault/canCircle/canMember/canTarget` (l.182-185).

| Sub-product | From | Event | To | Case ID |
|---|---|---|---|---|
| Vault | OPEN | mature / close | MATURED / CLOSED | `SAVINGS-FSM-001` |
| Vault | MATURED | close | CLOSED (terminal) | `SAVINGS-FSM-002` |
| Vault | CLOSED | any | (rejected) | `SAVINGS-FSM-003` |
| Circle | FORMING | activate / cancel | ACTIVE / CANCELLED | `SAVINGS-FSM-004` |
| Circle | ACTIVE | complete / cancel | COMPLETED / CANCELLED | `SAVINGS-FSM-005` |
| Circle | FORMING | complete (skip active) | (rejected) | `SAVINGS-FSM-006` |
| Member | INVITED | activate / exit | ACTIVE / EXITED | `SAVINGS-FSM-007` |
| Member | ACTIVE | default | DEFAULTED | `SAVINGS-FSM-008` |
| Member | DEFAULTED | make-good | ACTIVE (restore) | `SAVINGS-FSM-009` |
| Target | OPEN | reach / release / close | REACHED / RELEASED / CLOSED | `SAVINGS-FSM-010` |
| Target | REACHED | release / close | RELEASED / CLOSED | `SAVINGS-FSM-011` |
| Target | CLOSED / RELEASED→CLOSED | backward | (rejected) | `SAVINGS-FSM-012` |

Terminal re-entry and backward transitions must be rejected (`TestVaultFSM`/`TestCircleFSM`/`TestMemberFSM`/`TestTargetFSM` cover pure-logic; add DB-level guards where transitions are `UPDATE ... WHERE state=<from>`).

## 6. Security & abuse cases

- Owner/member/creator authZ + IDOR: `SAVINGS-AUTHZ-002..006`, especially the balance-read IDOR gap `SAVINGS-AUTHZ-003`. Reference `../cross-cutting/rbac-and-permissions.md`.
- Idempotency/replay/concurrency: `SAVINGS-INV-001..002`; `../cross-cutting/money-invariants.md`.
- Penalty tampering: `SAVINGS-SEC-002` — client-supplied `penalty_bps` with no minimum for locked vaults; treat penalty-free break as a defect.
- No tier/KYC gate: fact of absence — confirm intended for savings; cross-ref `../cross-cutting/kyc-and-tiers.md`.
- Audit gap: `SAVINGS-SEC-003` — nil auditor; `../cross-cutting/feature-flags-and-audit.md` AUDIT-INT-001.
- Conservation: `SAVINGS-SEC-004` and `SAVINGS-INV-003`; Paymax never tops up an Ajo pot; balances are derived. MONEY-INV-003/004.

## 7. Automated specs to add

- `internal/savings/vault_int_test.go` (live-DB) — deposit/withdraw/early-withdraw ledger legs, derived balance == SUM, idempotent replay, concurrent same-key, penalty routing to `paymax_revenue`, penalty=0 on FLEX/matured, locked-vault minimum-penalty enforcement.
- `internal/savings/ajo_int_test.go` — RunCycle end-to-end escrow legs, default → pot reduction (no top-up), make-good own-wallet funding + DEFAULTED→ACTIVE restore.
- `internal/savings/target_int_test.go` — contribute REACHED flip, majority-approval release to creator, non-creator release rejection.
- `internal/savings/authz_test.go` — owner/member/creator checks + balance-read IDOR (`SAVINGS-AUTHZ-003`), admin RBAC.
- `internal/savings/audit_test.go` — assert a mutation records an audit event once a real sink is wired (currently nil).
- Flag-off route-mount assertion (`SAVINGS-SEC-001`).

## 8. Coverage target & exit criteria

Tier-0 floor ≥ 85% pure-logic (FSMs + conservation already covered). **Exit criteria (release-blocking):** `SAVINGS-INT-001..007`, `SAVINGS-INV-001..003`, `SAVINGS-VAL-001..002`, `SAVINGS-AUTHZ-001..006`, `SAVINGS-SEC-001/004`, `SAVINGS-FSM-*` green. The three flagged gaps must be resolved or explicitly risk-accepted before go-live: balance-read IDOR (`SAVINGS-AUTHZ-003`), penalty-free locked-vault break (`SAVINGS-SEC-002`), and nil audit sink (`SAVINGS-SEC-003`).
