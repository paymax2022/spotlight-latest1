# Module: Academy Rewards (+ Gamification)

**Risk tier:** 1 &nbsp;·&nbsp; **Money-path:** yes (reward credits post to the Paymax wallet ledger) &nbsp;·&nbsp; **Feature flag:** `FEATURE_ACADEMY_ENABLED` (rewards + gamification are registered unconditionally inside `RegisterAcademy` — no sub-flag)
**Code:** `backend/internal/academy/rewards/` — `handler.go`, `service.go`, `model.go`, `repository.go`, `rewards_test.go`; `backend/internal/academy/gamification/` — `handler.go`, `service.go`, `logic.go`, `model.go`, `repository.go`, `gamification_test.go`; wiring in `backend/internal/app/academy_routes.go` (`RegisterAcademyRewards` with `ledgerSvc`, `RegisterAcademyGamification`).
**Slug:** `ACADEMYREWARDS`

## 1. Overview & scope

**Rewards** is the only always-on academy package that moves real value: `IssueReward` credits the
Paymax wallet ledger (injected `finance/ledger.Service`) from a funded, capped **reward pool** — no
shadow ledger. Issuance runs an ordered eligibility gate, locks the pool `FOR UPDATE`, appends an
immutable `academy_reward_ledger_entries` row + increments pool spent in one tx, then credits the
wallet with the same idempotency key. Balances are derived by summation. `RedeemPoints` credits the
wallet for wallet-kind SKUs (else records a `requested` fulfilment). **Gamification** (§2b) is
engagement-only — XP/levels/streaks/badges/leaderboards, **no money** (challenge reward payout is
delegated to `rewards.IssueReward`).

Applicable cross-cutting: `../cross-cutting/money-invariants.md` (I1–I12 on `IssueReward` /
`RedeemPoints`), `../cross-cutting/rbac-and-permissions.md` (admin `academy.rewards`),
`../cross-cutting/authentication.md`, `../cross-cutting/feature-flags-and-audit.md`.

## 2. Services / endpoints in scope

Member base `/api/finance/academy`; admin base `/api/academy/admin`.

**2a. Rewards** — admin group `/rewards` guarded `RequirePermission("academy.rewards")`:

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| Balance / history / catalog | `GET /rewards/balance`, `/history`, `/catalog` | member (owner) | no |
| Redeem points | `POST /rewards/redeem` | member; owner | **yes** (wallet-kind SKU) |
| List / create pool | `GET/POST /rewards/pools` | `academy.rewards` | no |
| Fund pool | `POST /rewards/pools/:id/fund` | `academy.rewards` | no (pool funding) |
| Pool ledger / global ledger | `GET /rewards/pools/:id/ledger`, `GET /rewards/ledger` | `academy.rewards` | no |
| Catalog read/create | `GET/POST /rewards/catalog` | `academy.rewards` | no |

`IssueReward` is the internal money path invoked by earning triggers (not a raw public POST): pool
locked, eligibility-gated, appends ledger entry, then `WalletCredit.Credit(ctx, userID, reference,
idemKey, debitAccountID, amountMinor)` with wallet ref `academy_reward:<key>`.

**2b. Gamification** — admin group `/gamification` (per-route slugs):

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| Profile / badges / leaderboard / challenges | `GET /gamification/profile`, `/badges`, `/leaderboards/:id` (`?period_key=`), `/challenges` | member (auth) | no |
| Config / badges read+upsert / leaderboard upsert | `GET /gamification/config`, `GET/POST /gamification/badges`, `POST /gamification/leaderboards` | `academy.content` | no |
| Upsert challenge | `POST /gamification/challenges` | `academy.sponsor` | no |

Amounts `int64` minor units (`RewardPool.FundedMinor/SpentMinor/PerUserCapMinor/PerCampaignCapMinor`,
`LedgerEntry.AmountMinor`, `CatalogItem.ValueMinor`, `Redemption.ValueMinor`). XP is a points counter,
not money.

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage | Status |
|---|---|---|---|
| Eligibility gate ordering (6 reasons) | unit | `rewards_test.go::TestEvaluateEligibility_Order` | AUTOMATED |
| Issue happy path (single credit) | unit/inv | `rewards_test.go::TestIssueReward_Happy` | AUTOMATED |
| Pool exhausted / per-user cap / fraud | unit | `rewards_test.go::TestIssueReward_PoolExhausted`, `TestIssueReward_PerUserCap`, `TestIssueReward_FraudFail` | AUTOMATED |
| Idempotent issue single effect | unit/inv | `rewards_test.go::TestIssueReward_DoubleIdempotencyKey_SingleEffect` | AUTOMATED |
| Balance derived by summation | unit/inv | `rewards_test.go::TestBalance_DerivedBySummation` | AUTOMATED |
| Redeem wallet-kind idempotent | unit/inv | `rewards_test.go::TestRedeemPoints_WalletKind_Idempotent` | AUTOMATED |
| XP→level curve / next-level | unit | `gamification_test.go::TestLevelForXP`, `TestLevelForXP_ClampsToMaxLevel`, `TestXPForNextLevel` | AUTOMATED |
| Streak apply / freeze | unit | `gamification_test.go::TestApplyStreak_*`, `TestGrantFreeze_CappedAtConfig` | AUTOMATED |
| Badge criteria | unit | `gamification_test.go::TestBadgeEarned_*` | AUTOMATED |
| Issue against real ledger + audit | integration | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `ACADEMYREWARDS-INT-001` | Issue reward credits wallet once | P0 | active funded pool | trigger `IssueReward` amount `25000` | key ≥8 | One ledger entry + one wallet credit; pool spent += 25000; wallet ref `academy_reward:<key>` |
| `ACADEMYREWARDS-INT-002` | Balance derived from entries | P0 | 2 issued rewards `30000`+`15000` | `GET /rewards/balance` | — | `45000` derived from `SumUserBalance` (no cached column) |
| `ACADEMYREWARDS-INT-003` | Redeem wallet-kind SKU credits wallet | P1 | user with points; wallet SKU | `POST /rewards/redeem` + key | wallet SKU | Fulfilled; one wallet credit `academy_redemption:<key>` |
| `ACADEMYREWARDS-INT-004` | Fund pool | P1 | holder; pool | `POST /rewards/pools/:id/fund {amountMinor}` | — | `FundedMinor` increased |
| `ACADEMYREWARDS-INV-001` | Issue idempotent replay | P0 | reward issued | replay same idempotency key | same key | Duplicate detected; same entry; one insert, one credit; spent incremented once (MONEY-INV-006) |
| `ACADEMYREWARDS-INV-002` | Concurrent same-key issue → one | P0 | funded pool | N=10 concurrent issue, one key | N=10 | Exactly one credit (MONEY-INV-007); pool `FOR UPDATE` serializes |
| `ACADEMYREWARDS-INV-003` | Pool exhausted → no credit | P0 | pool spent near funded | issue over remaining | over | `pool_exhausted`; no ledger/wallet movement |
| `ACADEMYREWARDS-INV-004` | Per-user cap enforced | P0 | user at `PerUserCapMinor` | issue more | over cap | `per_user_cap_exceeded`; no value moves |
| `ACADEMYREWARDS-INV-005` | Per-campaign cap enforced | P1 | campaign at `PerCampaignCapMinor` | issue more | over cap | `per_campaign_cap_exceeded`; no value moves |
| `ACADEMYREWARDS-INV-006` | Invalid amount is first gate | P0 | funded pool | issue amount `0`/negative | invalid | `invalid_amount` before any pool check; no movement |
| `ACADEMYREWARDS-SEC-001` | Anti-fraud block | P1 | fraud check rejects | issue | flagged | `anti_fraud_block`; no value moves |
| `ACADEMYREWARDS-AUTHZ-001` | Admin pool routes denied without permission | P0 | caller lacks `academy.rewards` | `POST /rewards/pools` | — | 403 `forbidden` |
| `ACADEMYREWARDS-AUTHZ-002` | Member balance/history owner-scoped (IDOR) | P0 | user A has rewards | user B `GET /rewards/balance` | — | B sees only own balance/history |
| `ACADEMYREWARDS-AUTHZ-003` | Gamification challenge upsert gated `academy.sponsor` | P1 | caller has `academy.content` only | `POST /gamification/challenges` | — | 403 (distinct slug from content) |
| `ACADEMYREWARDS-INT-005` | Badge grant idempotent | P2 | criteria met | grant same badge twice | — | Granted once (`(user_id, badge_id)` PK); no duplicate |
| `ACADEMYREWARDS-SEC-002` | No money in gamification | P1 | challenge with `RewardPoolID` | complete challenge | — | Payout only via `rewards.IssueReward`; gamification writes no ledger |
| `ACADEMYREWARDS-SEC-003` | Academy flag-off route inaccessible | P0 | `FEATURE_ACADEMY_ENABLED` off | Call rewards/gamification endpoint | — | Not mounted / 404 — never 500 (FLAG-SEC-001) |

## 5. State-machine transitions

Rewards has no `statemachine.go`; issuance is a procedural, ordered gate:
`triggered → eligibility_checked → credited | rejected`. Rejection reason **order** (asserted by
`TestEvaluateEligibility_Order`): `invalid_amount` → `pool_inactive` → `pool_exhausted` →
`per_user_cap_exceeded` → `per_campaign_cap_exceeded` → `anti_fraud_block`. Pool status
draft|active|exhausted|closed; redemption states requested|fulfilled|failed|reversed. Case IDs
`ACADEMYREWARDS-FSM-001` (gate order), `ACADEMYREWARDS-FSM-002` (redemption states).

## 6. Security & abuse cases

- **Single value movement:** reward credits post to the Paymax wallet ledger via one balanced credit;
  no shadow ledger (money-invariants I2/I3). Balances derived (`ACADEMYREWARDS-INT-002`).
- **Idempotent issuance:** unique idempotency key → one entry + one credit; `isDuplicateCredit` treats
  the ledger's `"duplicate idempotency key"` as a safe no-op (`ACADEMYREWARDS-INV-001`).
- **Caps + fraud gate** enforced in fixed order before any movement (`ACADEMYREWARDS-INV-003..006`,
  `SEC-001`).
- **Pool lock:** `SELECT ... FOR UPDATE` prevents overspend under concurrency (`ACADEMYREWARDS-INV-002`).
- **Admin authz:** `academy.rewards` (pools/catalog), `academy.content` (gamification config/badges/
  leaderboards), `academy.sponsor` (challenges) — assert each.
- **Money/engagement separation:** gamification never touches the ledger (`ACADEMYREWARDS-SEC-002`).

## 7. Automated specs to add

- `rewards/live_db_issue_test.go` — `IssueReward` against real ledger: balanced credit, replay no-op,
  concurrent same-key single credit under pool `FOR UPDATE`, audit emitted (I2/I5/I6/I11). TODO.
- `rewards/redeem_authz_test.go` — member redeem owner-scope; admin pool routes denied without
  `academy.rewards`. TODO.

## 8. Coverage target & exit criteria

Pure eligibility/issuance + gamification logic covered by `rewards_test.go` / `gamification_test.go`
(≥ 85% pure-logic). Exit: reward credit single-effect under replay/concurrency + caps/fraud + audit
proven against the real ledger; balances always derived; admin authz split enforced; flag-off
inaccessible.
