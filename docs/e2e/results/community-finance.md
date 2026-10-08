# Community Finance — E2E Coverage Sweep Results

Lane: `backend/internal/association/**`, `backend/internal/crowdfunding/**`,
`backend/internal/referral/**` (distinct from `internal/finance/referrals`,
already covered by `finance/fin-004-referrals.spec.ts`).

Date: 2027-02 run. Environment: local docker (`:8080` Go, `:3000` web,
`:54322` Postgres, Mailpit `:54324`).

## Test artifacts

| File | What it covers |
|------|----------------|
| `frontend-web/tests/e2e/community/helpers.ts` | Fixture helpers: `setKycVerified` (tier + kyc_status — the referral withdraw gate reads both), `seedCfBankAccount` (input row; no write API exists), `seedEligibleReferralReward` (input row for the §7A withdraw sweep), `countLegsByRef` / `ledgerTotalsByRef` (balanced-leg assertions), `adminCommunityGo` (bearer-only admin calls). |
| `frontend-web/tests/e2e/community/association.spec.ts` | Publish org (idempotent replay) → dues run (idempotent) → wallet pay → receipt → balanced legs; tier-0 member refusal (ZERO legs) → promote → retry succeeds; CLOSED-org application → founder approval; non-admin decision refusal; missing-Idempotency-Key refusal. |
| `frontend-web/tests/e2e/community/crowdfunding.spec.ts` | Campaign submit → publish → admin review/approve → contribute (idempotent, escrow+settle legs, 90/10 split) → campaign wallet/ledger → withdrawal (idempotent, balanced, tier-gated surface) → refund-request → release/refund guards → admin extension sweep → RBAC denial; engagement suite (comments/replies/reports, updates/likes, documents, broadcast, support tickets, notifications, prefs, save/unsave, pause→409→resume). |
| `frontend-web/tests/e2e/community/referral.spec.ts` | §7A withdraw sweep (eligible→wallet, balanced `referral:payout:*` legs, KYC fail-closed, idempotent replay, missing-key 400); claim-code late attribution; member report-abuse → admin alert; vanity links; gamification/compliance/network/merchant/campaign member reads; both admin consoles (`/api/referral/admin/*` 36 reads, `/v1/admin/referrals/*` 6 reads); RBAC denial. |
| `backend/internal/association/revenue_split_test.go` | `RevenueSplit` sums exactly to amount, remainder-safe (50/30/15/5). |
| `backend/internal/crowdfunding/milestone_status_test.go` | `submitMilestoneStatus` refuses creator-set RELEASED/PENDING_REVIEW. |
| `backend/internal/crowdfunding/wallet/project_running_balance_test.go` | Running-balance projection ordering + signed kobo accumulation. |
| `backend/internal/referral/ledger/transitions_test.go` | `forwardTransitions` state-machine legality (earned→pending→vesting→eligible→paid; clawed_back reachable everywhere; paid terminal). |

## Results

- Playwright: `npx playwright test tests/e2e/community --reporter=line` → **14/14 pass** (7 tests × chromium-desktop + mobile-chrome).
- Go: `TEST_DATABASE_URL=… go test ./internal/association/... ./internal/crowdfunding/... ./internal/referral/... -count=1` → **all packages ok** (incl. pre-existing live-DB suites).
- `go build` / `go vet` on the three modules → clean.
- `npm run test:regression` → 131/131 pass (golden path preserved).

## Journeys proven (money invariants)

### Association — `/api/finance/associations/*`
- `POST /` (publish): requires `acceptedTerms`, `logoUri`, `foundedYear`; replay with same `Idempotency-Key` returns the SAME `organisationId` (no duplicate org). Creates founder membership + SUPER_ADMIN.
- `POST /admin/organisations/:id/dues/run`: invoiced=1, totalKobo=150000; replay returns `alreadyRaised:true`, no double-billing.
- `POST /dues/:invoiceId/pay` (WALLET): 200 `status:SUCCESS`, `receiptId=rcpt_<invoiceId>`; ledger legs under `assoc_dues:<invoiceId>` **balanced DR=CR=150000**; `walletBalanceSql` drops exactly 150000; replay posts zero additional legs; `GET /me/dues` flips invoice to PAID; `GET /receipts/rcpt_*` returns amount/method, all `*_kobo` integer.
- Missing `Idempotency-Key` → 4xx, no legs.
- **Tier gate fail-closed**: kyc_tier=0 member pay → **403, ZERO legs** (`EnforceWalletDebitLimit` runs before ledger debit); same invoice pays fine after promotion+funding.
- `POST /apply` OPEN → auto-approve (member ACTIVE); CLOSED → pending; founder `POST /admin/approvals/:id/decision APPROVE` → member card/dashboard resolve; applicant deciding own application → **403**.

### Crowdfunding — `/api/finance/crowdfunding/*` + `/api/crowdfunding/admin/*`
- `POST /campaigns` (submitForReview) → `PENDING_REVIEW`; creator `POST /campaigns/:id/publish`; admin queue GET `/api/crowdfunding/admin/campaigns?status=PENDING_REVIEW` → `POST .../decision APPROVE` → ACTIVE.
- `POST /campaigns/:id/contribute` (body `idempotency_key`): 201; replay same key → same contribution id; escrow legs `escrow:campaign:…:contributor:…` **balanced 200000**; settle legs `settle:campaign:…` **balanced 200000** (DR escrow / CR creator 180000 + CR paymax_revenue 20000); creator wallet credited exactly 90%.
- **Tier gate fail-closed**: funded kyc_tier=0 contributor → **403, ZERO legs, no contributions row**.
- `GET /campaigns/:id/wallet` availableKobo ≥ 90% of contribution (real creator ledger balance); `GET /campaigns/:id/ledger` projected entries; `GET /ledger/:id` single entry.
- `POST /campaigns/:id/withdrawal-request` (header `Idempotency-Key` + seeded bank account): 201 `COMPLETED`, `reference=SPL-CFWD-*`; legs `cf:withdraw:SPL-CFWD-*` **balanced 100000** (DR user_wallet / CR provider_clearing); replay → same withdrawal id, no extra legs; `cf_audit_logs` row written.
- `POST /campaigns/:id/release` on funded campaign → 200 `releasedCount:0` (instant-settle already released); `POST /campaigns/:id/refund` on funded → **400**; on a contribution-free campaign → 200 `refundedCount:0` + status `failed`.
- `POST /contributions/:id/refund-request` → 200 `REFUND_REQUESTED` (row in `cf_refund_requests`); wrong owner → 404. **See E2E-COM-001/004.**
- `POST /creator/campaigns/:id/pause` → contribute → **409, zero new legs**; `/resume` → contribute succeeds.
- Engagement: comments POST/GET, creator reply, report, updates POST/GET, like, `POST /campaigns/:id/events` VIEW/SHARE, documents attach (storageKey must be `crowdfunding/documents/*`), broadcast, support tickets + reply, notifications + read, prefs GET/PUT, help, save/unsave, saved-campaigns, creator stats/campaigns/contributions/notifications/analytics/contributors/milestones.
- Admin reads (all 200 under super-admin): stats, finance/summary, refunds, settlements, disputes, withdrawals, campaign-directory, campaigns/:id/backers, campaigns/:id/funding, feature-requests, fraud-alerts, kyc, compliance/summary, compliance/audit-logs, users, config/{categories,fees,flags}. Member → `/api/crowdfunding/admin/stats` → **403** (RBAC `crowdfunding.admin.review`/`decide` split verified).

### Referral — `/api/finance/referral/*` + `/api/referral/admin/*` + `/v1/{admin/}referrals/*`
- `POST /withdraw` (header `Idempotency-Key`): seeded eligible row → 200 `withdrawn_kobo=75000, rewards_paid=1, remaining=0`; legs `referral:payout:<rewardId>` **balanced 75000** (DR referral_reward_expense / CR user_wallet); wallet +75000; row → `paid`; replay → no re-credit.
- `GET /withdraw-eligible` reflects seeded amount; `*` `_kobo` integers throughout.
- Missing key → 400, state untouched; unverified/tier-0 account → **403, no legs, row stays eligible** (fail-closed KYC gate `MinWithdrawTier` + `kyc_status='verified'`).
- `POST /claim-code` with engine link code → attribution; `GET /my-attribution` → 200.
- `POST /risk/report-abuse` empty target → resolves referrer server-side → 201 alert visible in `GET /api/referral/admin/risk/alerts`; self-report → 400.
- `POST /gamification/missions/:id/claim` without key → 400 (money-path idem guard).
- Member reads (200/404 acceptable): config, my-rewards, gamification/* (missions, progress, ranks, my-rank, badges, leaderboard, contests, streak), risk/my-status, compliance/consents, network/*, merchant/dashboard, campaigns, invite/vanity list+create.
- Admin reads (all 200): `/api/referral/admin/` config, house, house/ledger, reassignments, ledger, campaigns, gamification/{missions,ranks,contests}, network/{ambassadors,networks,override-policies}, merchants, risk/{dashboard,alerts,rules,cases,blocklist,review-queue,clawbacks}, compliance/{disclosures,aml,policy,claims,regulatory-export}, finance/{payouts,reconciliation,budgets,float,reward-to-ltv}, analytics/{k-factor,funnel,cac,cohorts,channels,segmentation}; `/v1/admin/referrals/` config, analytics, fraud-queue, ledger, milestones-log, module-status. Member → both admin consoles → **403**.

## Classification of remaining surface

| Module | Reachable E2E | Already covered (existing Go/live-DB + fin-004) | New unit tests added | Needs-seed / internal / flag-gated |
|---|---|---|---|---|
| association | 12 routes incl. both money paths | ~80% of admin/content/election/chat/member routes via `backend/tests/association/**` | 1 (RevenueSplit) | WS `/ws` (websocket client out of scope); multipart `admin/import/members` (CSV fixture); R2 presign (credentials unset → fail-closed 503 by design); committee/election writers (covered by live-DB tests) |
| crowdfunding | ~45 routes incl. all money paths | contribute idempotency/tamper/fee-split/frozen/disputes/CSR via `backend/tests/crowdfunding/**` | 2 (milestone status, running balance) | `cf_disputes`/`cf_refunds`/`cf_settlements` admin DECIDE mutations — **no write path exists from any member API** (see E2E-COM-001); investment + CSR member routes (read-only, profile-gated by onboarding seeds); admin config PATCH/PUT mutations (would mutate shared env config — exercised read side only) |
| referral | ~60 routes incl. withdraw money path | engine link/signup/attribute/internal hooks via `fin-004`; clawback/withdraw/payout-gate via `internal/referral/ledger/*_integration_test.go`; code admin via `backend/tests/referrals` | 1 (state machine) | Admin mutations creating real entities (campaign create/activate, mission/rank builders, rule upserts, payout queue, blocklist, reassign POST) — reachable but left to live-DB lanes; internal `/internal/referrals/*` already proven fail-closed by fin-004 (secret unset) |

## Findings

### E2E-COM-001 — HIGH — Contributor refund requests never reach the admin queue
- **Repro**: contributor `POST /api/finance/crowdfunding/contributions/:id/refund-request` → 200 `REFUND_REQUESTED`; row lands in `cf_refund_requests` (`creator/service.go:314-318`). Admin `GET /api/crowdfunding/admin/refunds` reads `cf_refunds` (`adminext/service.go:172`), and `DecideRefund` transitions `cf_refunds` rows (`adminext/service.go:199-235`). `cf_refunds` is populated ONLY by migration seed rows (`supabase/migrations/20260622050000_crowdfunding_admin.sql:25`) — no write path exists from any member-facing API.
- **Impact**: every member refund request is invisible to ops; the admin refund queue can only ever show seed/demo rows. Money-dispute dead end.
- **Evidence**: spec `crowdfunding.spec.ts` asserts the request row exists in `cf_refund_requests` while the admin queue (and a direct `cf_refunds` count) contains nothing.

### E2E-COM-002 — MEDIUM — report-abuse honours client-supplied `target_user_id`
- **Repro**: member `POST /api/finance/referral/risk/report-abuse {target_user_id:<any user>}` → **201**; only self-report is rejected (`risk/service.go:420`).
- **Why it matters**: the code comment (`risk/service.go:406-409`) explicitly says a client-supplied target is the vulnerability being closed ("would let anyone open a fraud alert against any account"), but the guard only resolves the referrer when the field is EMPTY — a non-empty client value is used verbatim. Any member can spam the fraud queue / flag arbitrary accounts.
- **Fix direction**: ignore/reject non-empty `target_user_id` for member calls (admin side channels exist for targeting).

### E2E-COM-003 — MEDIUM (ops) — Association flag split left the module unmounted
- **Repro**: `backend/.env` set `FEATURE_ASSOCIATION_ENABLED=true` (singular — DB module-visibility flag only) but not `FEATURE_ASSOCIATIONS_ENABLED` (plural — the Go mount gate, `config.go:793` → `finance_routes.go:1101`). Every `/api/finance/associations/*` returned **404** while the module registry reported it visible.
- **Impact**: exact failure class the `.env.example:354-379` comment warns about ("Off ⇒ routes never registered… indistinguishable from a wrong proxy path"). Verify staging/prod env matrices set BOTH.
- **Local fix applied**: added `FEATURE_ASSOCIATIONS_ENABLED=true` to untracked `backend/.env` and recreated the api container; spec then passes. No tracked file changed.

### E2E-COM-004 — HIGH — Crowdfunding refund path is structurally unreachable for real money
- **Repro**: `Contribute` instant-settles every contribution (`service.go:288-303` flips `escrowed`→`released` in the same request). `RefundAll` only refunds `status='escrowed'` rows (`service.go:430`) and refuses `funded` campaigns (`service.go:426`). E2E-verified both ways: a NON-funded campaign holding two real contributions (both `released`) → `POST /campaigns/:id/refund` returns **200 `refundedCount:0`** and marks the campaign `failed` — backers keep nothing refunded; and a funded campaign → 400.
- **Impact**: combined with E2E-COM-001 there is NO working refund path for a real contribution — member intent is dead (001) and the creator-side refund sweep can never find refundable money (004). Needs product decision: refund against released contributions (reversing entries) or revert to escrow-until-goal.
- **Severity rationale**: money-path semantics, not a crash — a backer literally cannot be made whole through any exposed route.
