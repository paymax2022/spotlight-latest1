# Module: Referral (reward ledger money-path)

**Risk tier:** 1 &nbsp;·&nbsp; **Money-path:** yes &nbsp;·&nbsp; **Feature flag:** `FEATURE_REFERRALS_ENABLED`
**Code:** `backend/internal/referral/ledger/` (`handlers.go`, `service.go`, `withdraw_test.go`, `withdraw_integration_test.go`); route wiring `backend/internal/app/referral_routes.go` (`RegisterReferral`, member group `/api/finance/referral`, admin group `/api/referral/admin`); parent gate + auth `backend/internal/app/finance_routes.go` (L284-286 `RequireAuthContext`+`requireUserID`; L341-357 `if cfg.FeatureReferralsEnabled`). Real payouts post through `backend/internal/finance/ledger/service.go` (`Credit`, standing account `AccountReferralReward` = `"referral_reward_expense"`).
**Slug:** `REFERRAL` (uppercase, used in Case IDs)

## 1. Overview & scope

The referral module is a large §7A growth engine spread across many sub-packages
(attribution, house, config, invite, campaigns, gamification, network, merchant, risk,
compliance, finance, analytics, events, ledger). This file scopes the **money-path core**:
the reward **ledger** (`internal/referral/ledger`), which owns the reward state machine over
`referral_reward_ledger` and the single member-facing wallet mutation,
`POST /api/finance/referral/withdraw`. It exposes three member endpoints —
`MySummary` (my-rewards), `MyEligible` (withdraw-eligible), `MyWithdraw` (withdraw) — plus one
admin view, `AdminList` (`GET /api/referral/admin/ledger`, RBAC `referral.ledger.view`).

`MyWithdraw` is a wallet **credit** equivalent: it sweeps ALL of the caller's `eligible`,
human (`is_house=false`), positive (`amount_kobo>0`) reward rows into their Spotlight wallet,
transitioning each row `eligible → paid` and posting a balanced double-entry per row
(CR beneficiary wallet / DR `referral_reward_expense` standing account) with a per-row
idempotency key `idempotencyKey + ":" + rowID`. It is (1) **fail-closed KYC-gated**
(`verifiedKYCTier ≥ MinWithdrawTier = 1`, unverified → tier 0 → 403), (2) **idempotent** on the
client `Idempotency-Key` header (the pay primitive dedups on key; the state flip is guarded
`WHERE state='eligible'`), (3) **serialized** by a per-user Postgres advisory lock
(`pg_advisory_lock(hashtext("referral:withdraw:"+userID))`), and (4) **audited** via an
optional sink keyed `"referral_withdraw:"+idempotencyKey`. Identity comes **only** from the
resolved token (`c.GetString("user_id")`), never the body — member endpoints take no
beneficiary parameter, so cross-user access (IDOR) is structurally impossible on the member
side; `AdminList` is the only endpoint that can read another user's rows and is RBAC-gated.

All cross-cutting invariants apply and are **not** repeated here: money
(`../cross-cutting/money-invariants.md`, I1-I12), auth
(`../cross-cutting/authentication.md`), RBAC (`../cross-cutting/rbac-and-permissions.md`),
KYC/tiers (`../cross-cutting/kyc-and-tiers.md`), flags/audit
(`../cross-cutting/feature-flags-and-audit.md`). Note the KYC gate here is a **referral-specific
tier floor** in `ledger.WithdrawEligible` (mirrors `referral/finance minPayoutTier`), not the
generic wallet-debit tier limit.

## 2. Services / endpoints in scope

| Operation | Method + path (or service func) | Auth / permission | Money-path? |
|---|---|---|---|
| Reward summary by state | `GET /api/finance/referral/my-rewards` → `MySummary` | token identity (`requireUserID`) | no |
| Eligible (withdrawable) balance | `GET /api/finance/referral/withdraw-eligible` → `MyEligible` | token identity | no |
| Sweep eligible → wallet | `POST /api/finance/referral/withdraw` → `MyWithdraw` | token identity + `Idempotency-Key` header + KYC tier ≥ 1 | **yes** |
| Admin reward-ledger view | `GET /api/referral/admin/ledger?beneficiary=` → `AdminList` | `RequirePermission("referral.ledger.view")` | no |
| Withdraw posting (service) | `ledger.WithdrawEligible(ctx, userID, idemKey)` | internal | yes |
| Payout posting (service) | `ledger.Transition(ctx, rewardID, "paid", key)` → `finance.Credit(...)` | internal | yes |

Behavioral notes to assert:
- `MyWithdraw` reads the idempotency key from the **`Idempotency-Key` HTTP header**, not the
  body. Missing/empty → **400** `{"error":"Idempotency-Key header required"}` before any DB
  access.
- `WithdrawEligible` error mapping in the handler: `ErrKYCRequired` → **403**; any other error →
  **500**; success → **200** with `WithdrawResult`.
- `MySummary` / `MyEligible`: empty `user_id` → **401** `{"error":"unauthenticated"}`;
  `GetSummary` error → **500**.
- `WithdrawResult` fields: `beneficiary_id`, `withdrawn_kobo` (int64 kobo), `rewards_paid` (int),
  `remaining_eligible_kobo` (int64 kobo, expected 0 under the lock), `currency` (default `"NGN"`).
- `MyEligible` response: `{beneficiary_id, eligible_kobo, currency:"NGN"}` (derived from
  `GetSummary`).
- `Summary.total_earned_kobo` sums every state **except** `clawed_back`; `by_state` is the raw
  per-state kobo map.
- Sibling RB1/RB2 endpoint families exist on the same groups (`RegisterReferralEcon`,
  `RegisterReferralTrust`: campaigns/gamification/network/merchant, risk/compliance/finance/
  analytics) and the RB0 config/attribution/house/invite endpoints
  (`GET/PUT /config`, `my-attribution`, `claim-code`, `invite/vanity`, admin `house`,
  `house/ledger`, `reassignments`). They share the same flag + auth gate; this file scopes the
  **ledger money-path** and covers only the config/attribution authz seams that bound it.

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| Withdraw input guards (empty beneficiary / empty key) fail before DB | unit | `internal/referral/ledger/withdraw_test.go` (`TestWithdrawEligible_Validation`) | AUTOMATED |
| KYC floor constant ≥ 1 documented | unit | `internal/referral/ledger/withdraw_test.go` (`TestMinWithdrawTier`) | AUTOMATED |
| Audit sink wiring/invocation | unit | `internal/referral/ledger/withdraw_test.go` (`TestSetAuditSink`) | AUTOMATED |
| Happy sweep: withdrawn == sum, rows → paid, remaining 0 | int | `internal/referral/ledger/withdraw_integration_test.go` (`TestWithdrawEligible_Integration`) | AUTOMATED (gated on `DATABASE_URL`/`TEST_DATABASE_URL`) |
| Balanced double-entry: wallet balance == withdrawn | inv | `withdraw_integration_test.go` (`TestWithdrawEligible_Integration`, balance assertion) | AUTOMATED (gated) |
| Idempotent replay: 2nd sweep credits nothing | inv | `withdraw_integration_test.go` (replay assertion, `res2.WithdrawnKobo==0`) | AUTOMATED (gated) |
| KYC gate fail-closed: tier 0 → `ErrKYCRequired` | inv/sec | `withdraw_integration_test.go` (`TestWithdrawEligible_KYCGate_Integration`) | AUTOMATED (gated) |
| Ledger primitive: balanced/kobo-only/projection/at-most-once | inv | `backend/tests/ledger_invariants_test.go` (shared oracle) | AUTOMATED (shared) |
| Concurrent same-user withdraw (advisory lock) → one credit | inv | — (no referral-specific concurrency test) | TODO |
| Handler status codes (400 missing header, 403 KYC, 200 shape) | con/int | — (service-level only; no `handler_test.go`) | TODO |
| House / zero-amount rows excluded from sweep | inv | — (implicit in query; not asserted) | TODO |
| Member IDOR (own-only) + token-vs-body identity | authz/sec | — | TODO |
| Admin `referral.ledger.view` allowed vs denied | authz | `../cross-cutting/rbac-and-permissions.md` (shared RBAC oracle) | PARTIAL |
| State-machine legality (forward-only + clawback) | fsm | — (map `forwardTransitions` untested directly) | TODO |
| Flag-off → routes not mounted (404) | sec | `../cross-cutting/feature-flags-and-audit.md` (FLAG-SEC-001, shared) | PARTIAL |
| Audit event emitted exactly once | int | `../cross-cutting/feature-flags-and-audit.md` (AUDIT-INT-001, shared) | PARTIAL |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `REFERRAL-INT-001` | Happy withdraw sweep | P0 | `qa-user-a` KYC verified tier 1; two `eligible` rows `100000` + `50000`; flag on | `POST /withdraw` with `Idempotency-Key: wd-a1` | header key only | 200 `{withdrawn_kobo:150000, rewards_paid:2, remaining_eligible_kobo:0, currency:"NGN"}`; both rows `paid`; wallet credited exactly `150000` |
| `REFERRAL-INT-002` | Summary aggregation across states | P1 | `qa-user-a` rows: earned `10000`, eligible `50000`, paid `30000`, clawed_back `20000` | `GET /my-rewards` | — | 200; `by_state` per-state kobo; `eligible_kobo:50000`; `paid_kobo:30000`; `clawed_back_kobo:20000`; `total_earned_kobo:90000` (excludes clawed_back) |
| `REFERRAL-INT-003` | Eligible balance read | P1 | `qa-user-a` eligible `50000` | `GET /withdraw-eligible` | — | 200 `{beneficiary_id:"qa-user-a", eligible_kobo:50000, currency:"NGN"}` |
| `REFERRAL-INT-004` | Withdraw with nothing eligible | P1 | `qa-user-a` tier 1, no eligible rows | `POST /withdraw` `Idempotency-Key: wd-a2` | — | 200 `{withdrawn_kobo:0, rewards_paid:0, remaining_eligible_kobo:0}`; no ledger posting; wallet unchanged |
| `REFERRAL-INT-005` | Admin ledger filtered by beneficiary | P1 | admin has `referral.ledger.view`; `qa-user-a` has rows | `GET /api/referral/admin/ledger?beneficiary=qa-user-a` | — | 200 `{entries:[...]}` for that beneficiary only, newest first, ≤200 |
| `REFERRAL-INT-006` | Admin ledger global (no filter) | P2 | admin has `referral.ledger.view` | `GET /api/referral/admin/ledger` | — | 200 recent rows across beneficiaries, `LIMIT 200` |
| `REFERRAL-CON-001` | Missing `Idempotency-Key` header | P0 | `qa-user-a` tier 1, eligible rows | `POST /withdraw` with **no** `Idempotency-Key` header | — | 400 `{"error":"Idempotency-Key header required"}`; nothing swept; wallet unchanged (MONEY-INV I10) |
| `REFERRAL-CON-002` | Withdraw response shape | P2 | happy path | `POST /withdraw` | valid | Body has exactly `beneficiary_id, withdrawn_kobo, rewards_paid, remaining_eligible_kobo, currency`; all kobo integers, no floats/strings |
| `REFERRAL-CON-003` | Summary response shape | P2 | as INT-002 | `GET /my-rewards` | — | Body has `beneficiary_id, total_earned_kobo, eligible_kobo, paid_kobo, clawed_back_kobo, by_state{}`; kobo integers only |
| `REFERRAL-INV-001` | Balanced double-entry on sweep | P0 | `qa-user-a` tier 1, eligible `150000` | `POST /withdraw` then read ledger | `wd-inv1` | Per row: CR wallet == DR `referral_reward_expense`; wallet balance rises by exactly `150000` (MONEY-INV I1, I3) |
| `REFERRAL-INV-002` | Idempotent replay (same key) | P0 | `qa-user-a` tier 1, eligible `150000` | `POST /withdraw` twice, same `Idempotency-Key: wd-r1` | identical | 1st sweeps `150000`; 2nd returns `withdrawn_kobo:0` (nothing eligible), wallet still `150000` — no double credit (MONEY-INV-006) |
| `REFERRAL-INV-003` | Concurrent withdraw → exactly-once | P0 | `qa-user-a` tier 1, eligible `150000` | Fire N=10 concurrent `POST /withdraw` (distinct keys) | over-parallel | Advisory lock serializes; each eligible row credited exactly once; wallet == `150000`; no row credited twice (MONEY-INV-007) |
| `REFERRAL-INV-004` | Kobo integers only | P0 | any withdraw/summary | Inspect all money fields | — | All amounts int64 minor units; reject any float/string in body or response (MONEY-INV-002) |
| `REFERRAL-INV-005` | House rows excluded from sweep | P0 | `qa-user-a` tier 1: eligible human `50000` + eligible `is_house=true` `1000000` | `POST /withdraw` `wd-h1` | — | Only `50000` swept; house row stays `eligible`, never credited (§7A.2 notional) |
| `REFERRAL-INV-006` | Zero / non-positive rows excluded | P1 | eligible rows `50000` + `0` | `POST /withdraw` `wd-z1` | — | Only `50000` swept (`amount_kobo>0` filter); zero row untouched |
| `REFERRAL-INV-007` | `total_earned_kobo` excludes clawed_back | P1 | earned/eligible/paid `90000`, clawed_back `20000` | `GET /my-rewards` | — | `total_earned_kobo:90000`; `clawed_back_kobo:20000` reported separately, not added |
| `REFERRAL-INV-008` | KYC tier gate fail-closed | P0 | `qa-user-c` `kyc_status='pending'`/tier 0, eligible `100000` | `POST /withdraw` `wd-k1` | — | 403 `ErrKYCRequired`; row stays `eligible`; wallet unchanged (KYC-* / MONEY-INV I12) |
| `REFERRAL-INV-009` | KYC lookup fail-closed | P0 | force `verifiedKYCTier` DB error | `POST /withdraw` | valid | Non-200 (500); nothing swept — error propagates, does not default-allow |
| `REFERRAL-INV-010` | Withdraw at exact tier floor | P1 | `qa-user-a` verified tier 1 (== `MinWithdrawTier`), eligible `50000` | `POST /withdraw` `wd-b1` | boundary | 200; swept `50000` (tier == floor is allowed, `<` is not) |
| `REFERRAL-AUTHZ-001` | Unauthenticated my-rewards | P0 | no/invalid token | `GET /my-rewards` | — | 401 (`RequireAuthContext`/`unauthenticated`); no data |
| `REFERRAL-AUTHZ-002` | Unauthenticated withdraw | P0 | no/invalid token | `POST /withdraw` | valid header | 401; nothing swept |
| `REFERRAL-AUTHZ-003` | Member IDOR — own rows only | P0 | `qa-user-a` token; `qa-user-b` has eligible rows | `GET /my-rewards`, `POST /withdraw` as A | — | A sees/sweeps only A's rows; B's rows untouched — endpoints take no beneficiary param, identity from token only |
| `REFERRAL-AUTHZ-004` | Admin ledger requires permission | P0 | caller lacks `referral.ledger.view` | `GET /api/referral/admin/ledger` | — | 403 forbidden fail-closed (RBAC-*); no entries returned |
| `REFERRAL-AUTHZ-005` | Admin config manage gated | P1 | caller lacks `referral.config.manage` | `PUT /api/referral/admin/config` | — | 403 fail-closed; `referral.config.view` alone insufficient to write |
| `REFERRAL-AUTHZ-006` | Suspended account blocked | P0 | `qa-suspended` valid token | `POST /withdraw` | valid header | 403 account restricted (AUTH-SEC-001); nothing swept |
| `REFERRAL-SEC-001` | Flag off → routes not mounted | P0 | `FEATURE_REFERRALS_ENABLED=false` | `GET /my-rewards`, `POST /withdraw`, `GET /api/referral/admin/ledger` | valid | 404 (whole `if cfg.FeatureReferralsEnabled` block skipped); never 500 (FLAG-SEC-001) |
| `REFERRAL-SEC-002` | Audit event emitted once | P0 | flag on, sink wired to referral events | `POST /withdraw` `wd-ae1` | — | Exactly one `referral_withdraw` event: actor `qa-user-a`, payload `{withdrawn_kobo, rewards_paid, currency}`, key `referral_withdraw:wd-ae1` (AUDIT-INT-001) |
| `REFERRAL-SEC-003` | Spoofed body `user_id` ignored | P0 | `qa-user-a` token | `POST /withdraw` with body `{user_id:"qa-user-b"}` + `Idempotency-Key: wd-sp1` | body includes victim id | Sweep hits `qa-user-a` only; B untouched — handler ignores body, uses `c.GetString("user_id")` |
| `REFERRAL-SEC-004` | Audit replay idempotent | P1 | sink dedups on key | Withdraw, then replay same `Idempotency-Key: wd-ae1` | — | Audit sink invoked with same key; no duplicate durable event (sink idempotent on key) |

## 5. State-machine transitions

`referral_reward_ledger.state` moves **forward-only**, with a clawback branch reachable from
every non-terminal state and from `paid` (`forwardTransitions` in `service.go`). `clawed_back`
is terminal. Withdraw drives only `eligible → paid`; other transitions are driven by
accrual/vesting/risk flows.

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| earned | vest step | pending | state flip only | `REFERRAL-FSM-001` |
| pending | vest step | vesting | state flip only | `REFERRAL-FSM-002` |
| vesting | mature | eligible | now withdrawable | `REFERRAL-FSM-003` |
| eligible | `MyWithdraw` (human, `amount>0`) | paid | balanced double-entry: CR wallet / DR `referral_reward_expense`, per-row idem key | `REFERRAL-FSM-004` |
| eligible | withdraw (house row) | paid | NOTIONAL — no wallet posting (`is_house` skips `finance.Credit`) | `REFERRAL-FSM-005` |
| paid | clawback | clawed_back | reversing entry posted for a real prior payout | `REFERRAL-FSM-006` |
| earned/pending/vesting/eligible | clawback | clawed_back | state flip (no wallet posting for not-yet-paid) | `REFERRAL-FSM-007` |
| X | X (same state) | X | idempotent no-op (`current == nextState` returns nil) | `REFERRAL-FSM-008` |

Illegal transitions to assert rejected with `ErrIllegalTransition`:

| From | Illegal event | Case ID | Expected |
|---|---|---|---|
| paid | → eligible (backward) | `REFERRAL-FSM-009` | rejected; row stays `paid`, no negative posting |
| earned | → paid (skip vesting/eligible) | `REFERRAL-FSM-010` | rejected; no wallet credit |
| clawed_back | → anything | `REFERRAL-FSM-011` | rejected; terminal is absorbing |
| eligible | → earned (backward) | `REFERRAL-FSM-012` | rejected |
| any | concurrent flip lost race, target != nextState | `REFERRAL-FSM-013` | `ErrIllegalTransition` "concurrent change"; re-read at target == success (idempotent) |

## 6. Security & abuse cases

- **Missing / weak Idempotency-Key** — `MyWithdraw` requires the `Idempotency-Key` **header**;
  absent → 400 (`REFERRAL-CON-001`). Note the ≥8-char rule for money mutations
  (`../cross-cutting/money-invariants.md` I10) is **not** enforced here — any non-empty header
  passes. Flag this gap; add a length check (§7).
- **Replay / double-credit** — `REFERRAL-INV-002`; the pay primitive dedups on key and the
  state flip is guarded `WHERE state='eligible'`, so a replay finds nothing eligible.
- **Concurrency / double-sweep** — `REFERRAL-INV-003`; per-user advisory lock
  (`pg_advisory_lock(hashtext("referral:withdraw:"+userID))`) serializes concurrent withdraws
  even with different keys, because the wallet credit posts before the guarded state flip.
- **KYC/tier gate & fail-closed** — `REFERRAL-INV-008/009`; unverified/missing profile resolves
  to tier 0 (`pgx.ErrNoRows → 0`), below `MinWithdrawTier=1` → 403. See `kyc-and-tiers.md`.
- **Identity spoofing / IDOR** — `REFERRAL-SEC-003`, `REFERRAL-AUTHZ-003`; member endpoints take
  identity only from the resolved token and expose no beneficiary parameter — one user can
  never read or sweep another's rewards. `AdminList` is the only cross-user reader and is
  RBAC-gated (`REFERRAL-AUTHZ-004`).
- **Amount tampering** — not applicable: `withdrawn_kobo` is summed server-side from stored
  `amount_kobo` rows; there is no client-supplied amount.
- **House/notional leakage** — `REFERRAL-INV-005`; house rows (`is_house=true`) must never post
  to a wallet even when `eligible`.
- **Fail-closed on flag off** — `REFERRAL-SEC-001` (404, never 500).
- **Brownfield boundary** — the ledger only writes `referral_reward_ledger` + posts finance
  ledger entries; it must never touch legacy contest/vote tables. Test setup must not modify
  protected paths.

## 7. Automated specs to add

- `internal/referral/ledger/handler_test.go` — httptest table over the four handlers: 401 on
  empty `user_id`; 400 on missing `Idempotency-Key` header; 403 on `ErrKYCRequired`; 200 shape
  for `MySummary`/`MyEligible`/`MyWithdraw`; spoofed body `user_id` ignored. Fake `*Service`
  seam via `gin` `httptest.NewRecorder`. Table-driven Go.
- `internal/referral/ledger/statemachine_test.go` — pure table over `forwardTransitions`:
  assert every legal move accepted and every illegal/backward move → `ErrIllegalTransition`;
  same-state → nil no-op. Table-driven Go, no DB.
- `backend/tests/referral_withdraw_concurrency_test.go` — DB-backed N-concurrent-same-user
  withdraw (distinct keys) asserting exactly-once wallet credit and no row paid twice
  (gated on `TEST_DATABASE_URL`). Mirrors `withdraw_integration_test.go` +
  `ledger_invariants_test.go`.
- `backend/tests/referral_withdraw_exclusions_test.go` — DB-backed: house rows and
  `amount_kobo<=0` rows are excluded from the sweep; only human positive rows credited.
- `internal/referral/ledger/idemkey_length_test.go` — assert (after adding) the
  `Idempotency-Key` header ≥ 8 chars, aligning with money-invariants I10.

## 8. Coverage target & exit criteria

Tier-1 money-path: ≥ 85% on `WithdrawEligible` + `Transition` (payout branch) + `MyWithdraw`
handler pure-logic. **Exit criteria (all green before release):** `REFERRAL-INT-001`,
`REFERRAL-CON-001`, `REFERRAL-INV-001`, `REFERRAL-INV-002`, `REFERRAL-INV-003`,
`REFERRAL-INV-005`, `REFERRAL-INV-008`, `REFERRAL-INV-009`, `REFERRAL-AUTHZ-003`,
`REFERRAL-AUTHZ-004`, `REFERRAL-SEC-001`, `REFERRAL-SEC-002`, `REFERRAL-SEC-003`, and FSM
legality `REFERRAL-FSM-004`/`REFERRAL-FSM-009`/`REFERRAL-FSM-011`. Any red among these is a
**do-not-ship** blocker.
