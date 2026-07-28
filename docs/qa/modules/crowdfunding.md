# Module: Crowdfunding

**Risk tier:** 0 &nbsp;·&nbsp; **Money-path:** yes &nbsp;·&nbsp; **Feature flag:** `FeatureCrowdfundingEnabled` / `FEATURE_CROWDFUNDING_ENABLED` (default `false`, `internal/config/config.go:558`; whole module mounts inside `if cfg.FeatureCrowdfundingEnabled` in `internal/app/finance_routes.go` ~L1195)
**Code:** `backend/internal/crowdfunding/` — root: `handler.go`, `handler_discovery.go`, `service.go`, `service_admin.go`, `service_discovery.go`, `model.go`, `query.go`, `dto.go`, `model_test.go`, `query_test.go`; subpackages: `wallet/` (derived wallet + ledger projection + PENDING withdrawal), `investment/` (regulated subscribe money-path), `creator/` (dashboard, milestones, refund-intent), `engage/` (support/notifications), `csr/` (corporate match), `adminext/` (admin review + withdrawal payout money-path — `withdraw_approve.go`, `withdraw_approve_test.go`, `service.go`, `config.go`). Wiring in `internal/app/finance_routes.go`.
**Slug:** `CROWDFUNDING`

## 1. Overview & scope

Nigerian crowdfunding vertical: creators submit campaigns for admin review, the public
contributes into **escrow**, and on success funds are **released 90/10** (creator/platform) via the
finance settlement engine; failed/cancelled campaigns **refund** all escrow. Every campaign has a
**derived wallet** (never a stored balance — computed from `contributions` + `cf_withdrawals` on
each read) and a **projected ledger feed** (signed kobo entries with running balance). Creators file
**PENDING-only withdrawal requests** (no money moves); an admin later **approves the payout**, which
is the single place a withdrawal actually posts to the finance ledger (DEBIT `AccountEscrow` / CREDIT
`AccountProviderClearing`). Adjacent slices: a regulated **investment** subscribe path (annual-limit
fail-closed), **CSR corporate matching** (budget-reserving), creator dashboard, engagement, and a
broad **admin extension** surface (refunds, disputes, KYC/KYB, fraud freeze, compliance, users,
config).

All monetary amounts are **integer kobo**. Contributions carry an idempotency key; withdrawals,
investment subscriptions and CSR matches require an `Idempotency-Key`; the withdrawal payout posts a
balanced double-entry keyed deterministically and writes an immutable `cf_audit_logs` row.

**Applicable cross-cutting:**
`../cross-cutting/money-invariants.md` (all money cases — escrow/settle/refund, withdrawal payout,
investment subscribe: integer kobo, idempotency, balanced double-entry, fail-closed limits),
`../cross-cutting/authentication.md` (every mutation reads identity from `c.GetString("user_id")`,
never from the body),
`../cross-cutting/rbac-and-permissions.md` (**see §6 — the admin group is gated only by
`requireUserID()`, with no RBAC permission check**),
`../cross-cutting/kyc-and-tiers.md` (investment onboarding gates: KYC + education + quiz + risk),
`../cross-cutting/webhooks-and-providers.md` (payout rail is a documented `TODO(prod)` — funds park
in clearing, no provider success is fabricated),
`../cross-cutting/feature-flags-and-audit.md` (flag-off ⇒ whole router tree absent; audit rows on
every admin decision).

## 2. Services / endpoints in scope

Member base `/api/finance/crowdfunding`; admin base `/api/crowdfunding/admin` (mounted on `r`, not
under finance). Money-path ✚ and privileged ★ ops called out explicitly.

### Root (`handler.go`, `handler_discovery.go`, `service.go`, `service_discovery.go`, `service_admin.go`)
| Operation | Method + path | Auth | Money-path? |
|---|---|---|---|
| List campaigns (discovery) | `GET /campaigns` | member | no |
| List categories | `GET /categories` | member | no |
| Campaign detail | `GET /campaigns/:id` | member | no |
| Submit campaign (create → review) | `POST /campaigns` | owner (from token) | no |
| Publish campaign | `POST /campaigns/:id/publish` | owner (`creator_id`) | no (draft→active) |
| ✚ Contribute (escrow) | `POST /campaigns/:id/contribute` | member + body `idempotency_key` | **yes** — `settlement.Escrow` |
| ✚ Release (90/10 payout) | `POST /campaigns/:id/release` | owner (`creator_id`) | **yes** — `settlement.Settle` + commission record |
| ✚ Refund all | `POST /campaigns/:id/refund` | owner (`creator_id`) | **yes** — `settlement.Refund` |
| ★ Admin stats | `GET /api/crowdfunding/admin/stats` | `requireUserID()` only | no |
| ★ Admin list pending | `GET /api/crowdfunding/admin/campaigns` | `requireUserID()` only | no |
| ★ Admin get campaign | `GET /api/crowdfunding/admin/campaigns/:id` | `requireUserID()` only | no |
| ★ Admin review decision | `POST /api/crowdfunding/admin/campaigns/:id/decision` | `requireUserID()` only | no (review FSM + audit) |

### `wallet/` (`routes.go`, `service.go`, `handler.go`, `model.go`)
| Operation | Method + path | Auth | Money-path? |
|---|---|---|---|
| Wallet summary (derived) | `GET /campaigns/:id/wallet` | member | no (read of derived balance) |
| Ledger feed (projected) | `GET /campaigns/:id/ledger` | member | no |
| Single ledger entry | `GET /ledger/:id` | member | no |
| Bank accounts (masked) | `GET /bank-accounts` | member (own) | no |
| ✚ File withdrawal request | `POST /campaigns/:id/withdrawal-request` | **creator only** + `Idempotency-Key` header | **yes-ish** — PENDING row, **no money moves**; fail-closed available-balance check |

### `investment/` (`routes.go`, `service.go`, `handler.go`, `model.go`)
| Operation | Method + path | Auth | Money-path? |
|---|---|---|---|
| Investor profile | `GET /investment/profile` | member | no |
| Advance onboarding gate | `POST /investment/onboarding` | member | no |
| List/detail offers | `GET /investment/offers`, `GET /investment/offers/:id` | member | no |
| Education / quiz | `GET /investment/education`, `GET /investment/quiz` | member | no |
| ✚ Subscribe | `POST /investment/subscribe` | member + `Idempotency-Key` header | **yes** — annual-limit fail-closed, onboarding-gated |
| Portfolio | `GET /investment/portfolio` | member (own) | no |

### `creator/` (`routes.go`, `service.go`, `handler.go`, `model.go`)
| Operation | Method + path | Auth | Money-path? |
|---|---|---|---|
| Contributors / milestones | `GET /campaigns/:id/contributors`, `GET /campaigns/:id/milestones` | member | no |
| Save / unsave campaign | `POST` + `DELETE /campaigns/:id/save` | member | no |
| Saved / recently viewed | `GET /saved-campaigns`, `GET /recently-viewed` | member (own) | no |
| My contributions | `GET /contributions`, `GET /contributions/:id` | member (own) | no |
| Refund intent (record only) | `POST /contributions/:id/refund-request` | member | no (**flags row, no money**) |
| Creator dashboard | `GET /creator/stats`, `/creator/campaigns`, `/creator/contributions`, `/creator/withdrawals`, `/creator/notifications`, `/creator/campaigns/:id/analytics` | member (own) | no |
| Reward fulfilment | `GET /rewards/backers`, `PUT /rewards/fulfilment/:id` | member | no |

### `engage/` (`routes.go`, `handler.go`, `model.go`)
| Operation | Method + path | Auth | Money-path? |
|---|---|---|---|
| Help articles | `GET /help` | member | no |
| Support tickets | `GET/POST /support/tickets`, `GET /support/tickets/:id`, `POST /support/tickets/:id/reply` | member (own) | no |
| Notifications | `GET /notifications`, `POST /notifications/read` | member (own) | no |
| Notification prefs | `GET/PUT /settings/notifications` | member (own) | no |

### `csr/` (`routes.go`, `service.go`, `handler.go`, `model.go`)
| Operation | Method + path | Auth | Money-path? |
|---|---|---|---|
| Sponsor profile | `GET /csr/profile` | member | no |
| Matchable campaigns | `GET /csr/campaigns`, `GET /csr/campaigns/:id` | member | no |
| List matches | `GET /csr/matches` | sponsor (own) | no |
| ✚ Set up match (reserve budget) | `POST /csr/matches` | sponsor + `Idempotency-Key` header | **yes-ish** — PENDING_APPROVAL, reserves cap |
| ★ Approve match | `POST /csr/matches/:id/approve` | sponsor (owns match) | no (PENDING_APPROVAL→ACTIVE) |
| Invoices / impact / employee giving | `GET /csr/invoices`, `/csr/impact`, `/csr/employee-giving` | sponsor (own) | no |

### `adminext/` (`routes.go`, `service.go`, `withdraw_approve.go`, `config.go`, `handler.go`, `model.go`)
Mounted on `/api/crowdfunding/admin`, `requireUserID()` only (no RBAC — see §6).
| Operation | Method + path | Money-path? |
|---|---|---|
| Finance summary | `GET /finance/summary` | no |
| ★ Refunds list / approve / reject | `GET /refunds`, `POST /refunds/:id/approve`, `POST /refunds/:id/reject` | no (FSM + audit) |
| Settlements list | `GET /settlements` | no |
| ★ Disputes list / resolve | `GET /disputes`, `POST /disputes/:id/resolve` | no |
| Withdrawals list | `GET /withdrawals` | no |
| ✚★ **Approve withdrawal (payout)** | `POST /withdrawals/:id/approve` | **YES** — DEBIT `AccountEscrow` / CREDIT `AccountProviderClearing`, `Idempotency-Key`, audit |
| ★ Reject withdrawal | `POST /withdrawals/:id/reject` | no (PENDING→REJECTED) |
| ★ Fraud list / freeze / unfreeze | `GET /fraud-alerts`, `POST /campaigns/:id/freeze`, `POST /campaigns/:id/unfreeze` | no |
| ★ KYC list / approve / reject | `GET /kyc`, `POST /kyc/:id/approve`, `POST /kyc/:id/reject` | no |
| Compliance | `GET /compliance/summary`, `/compliance/audit-logs`, `/compliance/data-requests`, `POST /compliance/data-requests/:id/fulfil` | no |
| ★ Users list / set status | `GET /users`, `POST /users/:id/status` | no |
| ★ Config categories/fees/flags | `GET /config/categories`, `PATCH /config/categories/:id`, `GET/PUT /config/fees`, `GET /config/flags`, `PATCH /config/flags/:key` | no (platform config) |

**~88 endpoints total** (root 8, root-admin 4, wallet 5, investment 8, creator 17, engage 9, csr 9,
adminext 28).

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| Campaign status enum sanity + terminal distinctness | UNIT | `internal/crowdfunding/model_test.go` (`TestCampaignStatusValues`) | AUTOMATED |
| Goal > 0, min 100 kobo binding | UNIT | `model_test.go` (`TestCampaignGoalMustBePositive`) | AUTOMATED |
| Raised ≤ Goal invariant, at-goal → funded | INV | `model_test.go` (`TestGoalVsRaisedInvariant`) | AUTOMATED |
| Contribution min 100 kobo + idempotency-key required | INV | `model_test.go` (`TestContributionMinimum`) | AUTOMATED |
| Contribution stores settlement_id for Settle/Refund | INV | `model_test.go` (`TestContributionSettlementIDField`) | AUTOMATED |
| Review-status FSM (APPROVE/REJECT/REQUEST_CHANGES/FREEZE/UNFREEZE + illegal) | FSM | `internal/crowdfunding/query_test.go` (`TestReviewTransition`) | AUTOMATED |
| Discovery WHERE builder (collection/category/search, ACTIVE gate) | UNIT | `query_test.go` (`TestBuildDiscoveryWhere_*`) | AUTOMATED |
| Sort clause mapping | UNIT | `query_test.go` (`TestSortClause`) | AUTOMATED |
| Mobile status mapping (CHANGES_REQUESTED→PENDING_REVIEW) | UNIT | `query_test.go` (`TestMobileStatus`) | AUTOMATED |
| Withdrawal payout fail-closed input guards (id/approver/idem) | UNIT | `internal/crowdfunding/adminext/withdraw_approve_test.go` (`TestApproveWithdrawal_Validation`) | AUTOMATED |
| Withdrawal payout refuses without wired ledger | UNIT/SEC | `withdraw_approve_test.go` (`TestApproveWithdrawal_FailsClosedWithoutLedger`) | AUTOMATED |
| Deterministic payout idempotency-key scheme | UNIT | `withdraw_approve_test.go` (`TestPayoutIdempotencyKeyScheme`) | AUTOMATED |
| Withdrawal state constants pinned to CHECK values | UNIT/FSM | `withdraw_approve_test.go` (`TestWithdrawalStateConstants`) | AUTOMATED |
| Contribute → escrow → funded (live DB) | INT | — (no `backend/tests/crowdfunding` suite exists) | TODO |
| Release 90/10 settlement split (creator/platform legs) | INT | — (settlement split covered generically in `backend/tests/settlement_split_test.go`, not for CF) | TODO |
| Withdrawal payout posts balanced DEBIT escrow / CREDIT clearing | INT | — | TODO |
| Withdrawal available-balance fail-closed (derived) | INT | — | TODO |
| Investment subscribe annual-limit fail-closed + idempotent | INT | — | TODO |
| CSR match reserve + PENDING_APPROVAL→ACTIVE | INT | — | TODO |
| Admin group missing RBAC (authz regression) | AUTHZ/SEC | — | TODO |
| Contribution idempotency replay (same key ⇒ no double escrow) | INV | — (relies on `settlement.Escrow` idempotency) | TODO |

> No `backend/tests/crowdfunding/` directory exists (verified). All INT/E2E coverage is TODO;
> only pure-logic UNIT/FSM/INV assertions are automated today.

## 4. Manual test cases

Money in **integer kobo**, kobo-exact.

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `CROWDFUNDING-E2E-001` | Happy path: create → publish → contribute → fund → release | P0 | flag on; creator + contributor auth; ledger+settlement wired | Submit campaign; publish; contribute goal amount; creator releases | goal `5_000_000`, contribute `5_000_000`, idem `c-001` | campaign `draft`→`active`→`funded`; contribution `escrowed`→`released`; settlement split posts creator 90% (`4_500_000`) + platform 10% (`500_000`); commission earning row (Community/Crowdfunding, gross `5_000_000`) |
| `CROWDFUNDING-E2E-002` | Withdrawal cash-out: request → admin approve payout | P0 | funded+released campaign with available balance; creator owns 1 saved bank account; ledger wired | Creator files withdrawal-request (PENDING); admin approves | amount `1_000_000`, idem header `w-001` | request `PENDING`; approval posts DEBIT `AccountEscrow` / CREDIT `AccountProviderClearing` `1_000_000`; status `PENDING`→`COMPLETED`; `cf_audit_logs` row `withdrawal.approve.payout`; `Posted=true` |
| `CROWDFUNDING-E2E-003` | Refund path: unfunded/cancelled campaign refunds all escrow | P0 | active campaign with escrowed contributions, below goal | Creator calls refund | 2 contributions `300_000`,`200_000` | each contribution `escrowed`→`refunded` via `settlement.Refund`; campaign `→failed`; wallet escrow drops to 0 |
| `CROWDFUNDING-CON-001` | Contribute rejects goal amount < 100 kobo | P1 | active campaign | POST contribute `amount_kobo=50` | `50` | 400 binding error (`min=100`) |
| `CROWDFUNDING-CON-002` | Contribute rejects missing idempotency_key | P0 | active campaign | POST contribute body without `idempotency_key` | — | 400 binding error (`required`) |
| `CROWDFUNDING-CON-003` | Contribute rejected on non-active campaign | P1 | campaign in `draft`/`funded`/`failed` | POST contribute | `100_000` | 500 "campaign is not accepting contributions" |
| `CROWDFUNDING-CON-004` | Contribute rejected after deadline | P1 | active campaign, deadline in past (seed) | POST contribute | `100_000` | error "campaign deadline has passed"; no escrow |
| `CROWDFUNDING-CON-005` | Create rejects past deadline | P2 | creator auth | POST campaign deadline yesterday | — | error "deadline must be in the future" |
| `CROWDFUNDING-CON-006` | Withdrawal rejects amount > available balance | P0 | released balance `500_000`, no prior withdrawals | POST withdrawal-request `600_000` | `600_000`, idem `w-neg` | error "amount 600000 kobo exceeds available balance 500000 kobo"; no row |
| `CROWDFUNDING-CON-007` | Withdrawal on frozen campaign refused | P1 | campaign `review_status=FROZEN` | POST withdrawal-request | `100_000` | error "campaign is frozen — withdrawals are disabled" |
| `CROWDFUNDING-AUTHZ-001` | Publish denied for non-owner | P0 | campaign owned by user A | User B POST publish | — | "campaign not found or already active" (owner-scoped UPDATE, 0 rows) |
| `CROWDFUNDING-AUTHZ-002` | Release denied for non-owner (IDOR) | P0 | funded campaign owned by A | User B POST release | — | "campaign not found" (creator-scoped SELECT) — funds not released |
| `CROWDFUNDING-AUTHZ-003` | Withdrawal-request denied for non-creator (IDOR) | P0 | campaign owned by A | User B POST withdrawal-request with valid bank acct | idem `w-idor` | "only the campaign creator may request a withdrawal"; no row |
| `CROWDFUNDING-AUTHZ-004` | Withdrawal bank account must belong to caller | P1 | creator A, bank acct owned by B | Creator A POST withdrawal-request `bankAccountId=<B's>` | idem `w-bank` | "bank account not found" (user-scoped lookup) |
| `CROWDFUNDING-AUTHZ-005` | CSR approve-match denied for non-owning sponsor | P1 | match owned by sponsor A | Sponsor B POST match approve | — | not found / no transition (sponsor-scoped `WHERE sponsor_id`) |
| `CROWDFUNDING-BND-001` | Contribute exactly reaching goal flips funded | P1 | active goal `1_000_000`, raised `900_000` | Contribute `100_000` | `100_000` | raised `1_000_000` == goal ⇒ `checkAndMarkFunded` sets `funded` |
| `CROWDFUNDING-BND-002` | Contribute overshooting goal still funds (raised>goal) | P2 | active goal `1_000_000`, raised `900_000` | Contribute `500_000` | `500_000` | raised `1_400_000`; campaign `funded`; no cap enforced (documents behavior) |
| `CROWDFUNDING-BND-003` | Withdraw exactly available balance succeeds; second is zero-available | P1 | available `1_000_000` | Withdraw `1_000_000` then request `1` | `1_000_000`,`1` | first PENDING ok; after approve, available `0`; second refused (exceeds/`0`) |
| `CROWDFUNDING-INV-001` | Contribution idempotency replay (same key) | P0 | active campaign | POST contribute twice with idem `c-dup` | `250_000`,`250_000` | second reuses escrow via `settlement.Escrow` idempotency — escrow total `250_000`, not `500_000` |
| `CROWDFUNDING-INV-002` | Withdrawal idempotency replay returns prior PENDING | P0 | creator, available `1_000_000` | POST withdrawal-request twice, idem `w-dup` | `400_000` | second returns the existing PENDING request unchanged; one `cf_withdrawals` row |
| `CROWDFUNDING-INV-003` | Withdrawal payout replay posts ledger once | P0 | approved-once withdrawal | Re-invoke admin approve | idem `cf:withdraw:payout:<id>` | ledger `ErrDuplicate` swallowed; `Posted=false`; status stays `COMPLETED`; no second journal |
| `CROWDFUNDING-INV-004` | Investment subscribe annual-limit fail-closed | P0 | onboarded investor, `annual_limit=1_000_000`, invested `900_000` | POST subscribe `200_000` | idem `inv-lim` | `ErrAnnualLimit`; no subscription; running total unchanged |
| `CROWDFUNDING-INV-005` | Subscribe blocked before onboarding complete | P1 | investor not onboarded | POST subscribe | `100_000`, idem `inv-onb` | error (onboarding gate); no row |
| `CROWDFUNDING-INV-006` | Subscribe idempotency replay returns same certificate | P1 | onboarded investor | POST subscribe twice idem `inv-dup` | `100_000` | second returns existing certificate; annual total incremented once; offer raised/count incremented once |
| `CROWDFUNDING-INT-001` | Release concurrency: two simultaneous release calls | P1 | funded campaign, escrowed contributions | Fire release ×2 | — | each escrowed contribution settled once (guarded by `status='escrowed'` UPDATE); no double payout |
| `CROWDFUNDING-INT-002` | Withdrawal approve concurrency (race) | P0 | PENDING withdrawal | Two admins approve simultaneously | idem shared | exactly one COMPLETED, one journal; loser re-reads COMPLETED as idempotent success (`RowsAffected==0` branch) |
| `CROWDFUNDING-SEC-001` | Flag-off — all crowdfunding routes absent | P0 | `FEATURE_CROWDFUNDING_ENABLED=false` | GET `/api/finance/crowdfunding/campaigns`; POST admin approve | — | 404 (router tree not mounted) — see `../cross-cutting/feature-flags-and-audit.md` |
| `CROWDFUNDING-SEC-002` | Audit row written on every admin money/state decision | P1 | admin, seeded rows | Approve withdrawal / decide refund / freeze | — | corresponding `cf_audit_logs` row committed atomically (approve.payout, refund.approve, campaign.freeze) |

## 5. State-machine transitions

Real enum values taken from the code. Illegal transitions asserted rejected; terminal re-entry
idempotent.

### 5a. Campaign lifecycle `campaigns.status` — `draft | active | funded | failed | cancelled` (`model.go:13`)
| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| (none) | `Create` | `draft` | insert row (`service.go` Create) | `CROWDFUNDING-FSM-001` |
| `draft` | `Publish` (owner) | `active` | owner-scoped UPDATE `WHERE status='draft'` | `CROWDFUNDING-FSM-002` |
| `active` | contribution meets goal (`checkAndMarkFunded`) | `funded` | UPDATE `WHERE status='active'` | `CROWDFUNDING-FSM-003` |
| `active`/`draft` | `RefundAll` (not funded) | `failed` | refund all escrow, then `status='failed'` | `CROWDFUNDING-FSM-004` |
| `funded` | `Release` (owner) | `funded` (unchanged) | contributions `escrowed`→`released`; 90/10 settle | `CROWDFUNDING-FSM-005` |

Illegal / asserted-rejected:
- `Publish` on already-`active`/`funded` ⇒ 0 rows, "not found or already active" (`CROWDFUNDING-FSM-006`).
- `Release` when status ≠ `funded` ⇒ "must be in 'funded' state" (`CROWDFUNDING-FSM-007`).
- `RefundAll` when status == `funded` ⇒ "cannot refund a funded campaign" (`CROWDFUNDING-FSM-008`).
- `cancelled` is an enum member but no service transition currently emits it — assert no code path
  reaches it (documents dead state) (`CROWDFUNDING-FSM-009`).

### 5b. Review status `campaigns.review_status` — `PENDING_REVIEW | CHANGES_REQUESTED | ACTIVE | REJECTED | FROZEN` (`service_admin.go` `reviewTransition`, tested in `query_test.go`)
| From | Event (decision) | To | Side effect | Case ID |
|---|---|---|---|---|
| `PENDING_REVIEW` | `APPROVE` | `ACTIVE` | sets `status='active'`; `campaign_reviews` audit row | `CROWDFUNDING-FSM-010` |
| `CHANGES_REQUESTED` | `APPROVE` | `ACTIVE` | audit row | `CROWDFUNDING-FSM-011` |
| `PENDING_REVIEW` | `REJECT` (note req.) | `REJECTED` | audit row | `CROWDFUNDING-FSM-012` |
| `PENDING_REVIEW` | `REQUEST_CHANGES` (note req.) | `CHANGES_REQUESTED` | audit row | `CROWDFUNDING-FSM-013` |
| `ACTIVE`/`PENDING_REVIEW` | `FREEZE` (note req.) | `FROZEN` | audit row; disables withdrawals | `CROWDFUNDING-FSM-014` |
| `FROZEN` | `UNFREEZE` | `ACTIVE` | audit row | `CROWDFUNDING-FSM-015` |

Illegal (from `TestReviewTransition`, assert `ok=false`): `ACTIVE`+`APPROVE`, `REJECTED`+`APPROVE`,
`COMPLETED`+`FREEZE`, `ACTIVE`+`REQUEST_CHANGES`, `DRAFT`+`APPROVE` (`CROWDFUNDING-FSM-016`). Note
`REJECT`/`REQUEST_CHANGES`/`FREEZE` without a note ⇒ error before any write (`CROWDFUNDING-FSM-017`).

### 5c. Milestone status `cf_campaign_milestones.status` — `LOCKED | ACTIVE | RELEASED | PENDING_REVIEW` (`creator/model.go` `CampaignMilestone`)
| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| `LOCKED` | milestone activated (goal/stage reached) | `ACTIVE` | read-only surface today | `CROWDFUNDING-FSM-018` |
| `ACTIVE` | evidence submitted | `PENDING_REVIEW` | evidence count > 0 | `CROWDFUNDING-FSM-019` |
| `PENDING_REVIEW` | admin approves evidence | `RELEASED` | (funds-release hook — future slice) | `CROWDFUNDING-FSM-020` |

> Milestones are currently **read-only** (`GetMilestones`); no service mutator exists yet. Assert the
> enum is the only surface and that no transition endpoint mutates it (`CROWDFUNDING-FSM-021`, TODO).

### 5d. Withdrawal request `cf_withdrawals.status` — `PENDING | APPROVED | COMPLETED | REJECTED` (+ `PROCESSING` referenced in derivations) (`adminext/withdraw_approve.go` constants)
| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| (none) | `SubmitWithdrawal` (creator) | `PENDING` | insert row, **no money moves**; available-balance check | `CROWDFUNDING-FSM-022` |
| `PENDING` | `DecideWithdrawal` approve (admin, no money) | `APPROVED` | audit `withdrawal.approve` | `CROWDFUNDING-FSM-023` |
| `PENDING` | `DecideWithdrawal` reject (note req.) | `REJECTED` | audit `withdrawal.reject` | `CROWDFUNDING-FSM-024` |
| `PENDING`/`APPROVED` | `ApproveWithdrawal` payout (money-path) | `COMPLETED` | DEBIT escrow / CREDIT clearing; audit `withdrawal.approve.payout` | `CROWDFUNDING-FSM-025` |
| `COMPLETED` | `ApproveWithdrawal` replay | `COMPLETED` | idempotent no-op; `Posted=false`; no journal | `CROWDFUNDING-FSM-026` |

Illegal / asserted-rejected:
- `ApproveWithdrawal` on `REJECTED` (or any non PENDING/APPROVED/COMPLETED) ⇒ `ErrWithdrawalIllegalState`
  (`CROWDFUNDING-FSM-027`).
- `DecideWithdrawal` on non-`PENDING` ⇒ "cannot decide a withdrawal in <state> state"
  (`CROWDFUNDING-FSM-028`).
- Payout with `amount <= 0` ⇒ rejected before posting (`CROWDFUNDING-FSM-029`).
- Terminal `COMPLETED`/`REJECTED` re-entry is idempotent/rejected, never double-posts (`CROWDFUNDING-FSM-030`).

### 5e. Adjacent guarded FSMs (assert-rejected on illegal, note-required)
- Refund `cf_refunds.status`: `REQUESTED → APPROVED | REJECTED` (`DecideRefund`; non-`REQUESTED`
  rejected; reject needs note) (`CROWDFUNDING-FSM-031`).
- CSR match `cf_csr_matches.status`: `PENDING_APPROVAL → ACTIVE` (`ApproveMatch`; non-`PENDING_APPROVAL`
  rejected) → `COMPLETED` (impact-only) (`CROWDFUNDING-FSM-032`).
- KYC `cf_kyc_cases.status`: `PENDING → APPROVED | REJECTED` (`DecideKyc`) (`CROWDFUNDING-FSM-033`).
- Dispute `cf_disputes.status`: `→ RESOLVED` (guarded; `RESOLVED`/`CLOSED` rejected) (`CROWDFUNDING-FSM-034`).
- Investment subscription `cf_investment_subscriptions.status`: created `ACTIVE` (portfolio also
  shows `EXITED | DEFAULTED`; no mutator yet) (`CROWDFUNDING-FSM-035`).

## 6. Security & abuse cases

Reference `../cross-cutting/money-invariants.md`, `rbac-and-permissions.md`, `authentication.md`,
`feature-flags-and-audit.md`. Crowdfunding-specific:

- **★ Admin group has NO RBAC permission gate.** `cfAdmin := r.Group("/api/crowdfunding/admin")`
  applies only `requireUserID()` (`finance_routes.go`), and `cfadminext.RegisterAdmin` mounts the
  withdrawal-payout money-path, refunds, KYC, freeze, user-status and config under it. Any
  authenticated user could hit `POST /api/crowdfunding/admin/withdrawals/:id/approve`. **This is the
  top finding** — add a `RequirePermission("crowdfunding.admin")` middleware and an AUTHZ regression
  test (`CROWDFUNDING-SEC-003`). Compare against academy commerce which gates its admin group with
  `RequirePermission`.
- **Amount tampering on release / withdrawal.** Contribution/settlement amounts are server-derived
  (escrow amount from the stored contribution; payout `amount_kobo` from the stored row). Assert the
  client cannot re-price a release or inflate a payout (`CROWDFUNDING-SEC-004`). Investment/CSR/
  withdrawal reject client amounts that fail server-side gates (annual-limit / available-balance /
  cap).
- **Idempotency-Key inconsistency (abuse surface).** Root `Contribute` reads the key from the
  **request body** (`ContributeRequest.IdempotencyKey`), while wallet/investment/csr read it from the
  **`Idempotency-Key` header** (`c.GetHeader`). Verify a body-supplied contribution key still enforces
  at-most-once escrow, and that an attacker cannot bypass idempotency by omitting the header where a
  body field is expected (`CROWDFUNDING-SEC-005`).
- **Missing/blank Idempotency-Key** on withdrawal / subscribe / CSR match ⇒ 400 before any DB access
  (fail-closed). See `money-invariants.md`.
- **Fail-closed on dependency error:** payout refuses when the finance ledger is nil
  (`ErrLedgerUnavailable`, already tested) — never flips state without posting money.
- **IDOR / object-level:** covered in §4 (`AUTHZ-002..005`) — release, withdrawal-request, bank
  account, CSR match are all owner/sponsor-scoped in SQL.
- **Discovery injection:** `buildDiscoveryWhere`/`sortClause` use positional args and a fixed sort
  allowlist (no user input interpolated) — assert search/category/sort cannot inject SQL
  (`CROWDFUNDING-SEC-006`).
- **Frozen-campaign bypass:** withdrawals blocked when `review_status=FROZEN`; assert a frozen
  campaign cannot pay out even via a pre-existing PENDING request approval (`CROWDFUNDING-SEC-007`).

## 7. Automated specs to add

- `backend/tests/crowdfunding/contribute_escrow_test.go` — live-DB (gated on `TEST_DATABASE_URL`):
  contribute → escrow → funded transition + idempotency replay (no double escrow). Table-driven Go.
- `backend/tests/crowdfunding/release_split_test.go` — release posts creator 90% / platform 10% legs
  balanced to the contribution; commission earning row appended once (idempotent on replay).
- `backend/tests/crowdfunding/withdrawal_payout_test.go` — `ApproveWithdrawal` posts balanced DEBIT
  `AccountEscrow` / CREDIT `AccountProviderClearing`; replay posts once (`Posted=false`); illegal
  from `REJECTED`; concurrency race yields one COMPLETED.
- `backend/internal/crowdfunding/wallet/service_test.go` — `SubmitWithdrawal` available-balance
  fail-closed, owner-only, frozen-block, idempotent replay (mock/pgxmock or live-DB).
- `backend/internal/crowdfunding/investment/service_test.go` — annual-limit fail-closed, onboarding
  gate, subscribe idempotency, offer-status gate (`OPEN`/`CLOSING_SOON` only).
- `backend/internal/crowdfunding/csr/service_test.go` — `SetupMatch` reserve + idempotency;
  `ApproveMatch` guarded PENDING_APPROVAL→ACTIVE + sponsor scope.
- `backend/tests/crowdfunding/admin_authz_test.go` — **regression** asserting the admin group
  rejects a caller lacking `crowdfunding.admin` (fails today — see §6 SEC-003).

All above marked TODO in the traceability matrix (§3).

## 8. Coverage target & exit criteria

Tier 0 money-path: **≥ 85% on pure logic** (`reviewTransition`, `buildDiscoveryWhere`, `sortClause`,
`mobileStatus`, withdrawal state constants/guards — already covered) and **≥ 90% branch coverage on
the withdrawal-payout and release/refund money paths** once INT specs land.

**Exit (release-ready) — all P0 must pass:**
`E2E-001` (create→fund→release with correct 90/10 split), `E2E-002` (withdrawal request→payout with
balanced ledger + audit), `E2E-003` (refund drains escrow), `CON-002`/`CON-006` (idempotency &
available-balance fail-closed), `AUTHZ-002`/`AUTHZ-003` (release/withdrawal IDOR), `INV-001`/`INV-003`
(contribution & payout idempotency), `INV-004` (investment annual-limit fail-closed),
`INT-002` (payout race), `SEC-001` (flag-off 404), and **`SEC-003` (admin RBAC gate)** — the module
must not ship the admin money-path behind `requireUserID()` alone.
