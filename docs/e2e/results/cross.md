# CROSS-ROLE module — production E2E validation results

Date: 2026-10-03. Stack exercised live: Next dev :3000 (BFF + UI, proxies to `GO_BACKEND_URL=http://localhost:8080`), Go api :8080, GoTrue via Kong :54321, Postgres `supabase_db_spotlight` :54322. Paystack unreachable (placeholder keys) — wallet rail is the only live money rail.

Specs: `frontend-web/tests/e2e/cross/` — 6 specs / 8 tests, all green on `chromium-desktop` (~5.9s, 5 workers): `cross-001-order-completion`, `cross-002-contest-lifecycle`, `cross-003-transfer`, `cross-004-audit-continuity`, `vote-001-paid-vote-atomicity`, `vote-002-callback` (3 tests). Every actor is a fresh `provisionVerifiedUser` account; the admin fixture `admin@spotlight.internal` is used only for real admin gates.

Cross-role chains covered: **customer → owner → rider → admin → settlement ledger** (restaurant order), **admin → applicant → voter → admin console** (contest lifecycle), **user A → user B → shared ledger** (transfer), plus the two carried-over vote findings (VOTE-001/AUD-DB-002, VOTE-002/AUD-FE-007) and audit-trail continuity (CROSS-004).

Environment facts verified before/during testing:
- `wallet_balance` is a projection over `ledger_entries`; fixture funding posts the same balanced journal the top-up webhook posts (DR `provider_clearing` / CR `user_wallet`). psql is used ONLY for fixture setup (wallet funding journal, `user_profiles.phone`, `user_profiles.kyc_tier`, `drivers` rider row, `vote_transactions` pending row) and read-back verification — never to move product state.
- Auto-dispatch picks `drivers` rows with `status='online'` + `verification_status='approved'`; `drivers.user_id` is the rider's auth id. The rider row is seeded (fixture) because there is no local rider-registration flow.
- Order settlement: `settlement.ComputeLegs` prices the percentage split on `gross = total − tip − serviceFee − packagingFee`; the three excluded legs pay 100% to rider/platform/provider respectively (`backend/internal/restaurant/service.go:1294-1370`, `splitProviderPct=0.80 / splitPlatformPct=0.10 / splitRiderPct=0.10`).
- `contests.id == connect_contests.id` for admin-created contests (legacy→connect mirror on INSERT), but they are NOT interchangeable as contestants' foreign keys — see F-C2.
- `audit_logs` (Go) and `vote_audit_logs` (BFF voting) are separate data planes; each was queried on its own plane.
- `FEATURE_VOTE_BRIDGE_ENABLED` is unset and `VOTES_BRIDGE_ENABLED` unset → the v2 vote-bridge wallet route is flag-gated OFF locally (403 "Wallet voting is not enabled", `app/api/v2/votes/wallet/route.ts:67-69`). The v1 `/api/votes/paid/wallet` route is the reachable paid-vote rail.

## Verdicts

| ID | Journey | Verdict |
|----|---------|---------|
| CROSS-001 | multi-actor restaurant order → escrow settlement | **PASS** — customer wallet-order 201 → owner `pending→confirmed→preparing→ready` (customer PATCH 403) → auto-dispatch offers to the seeded rider → wrong-actor accept 400 → rider accept → wrong POD codes 400 → pickup code → `picked_up` → delivery code → `delivered` → settlement `escrowed→settled`, escrow fully released, provider/rider/platform credited exactly. Admin feed + customer read both show `delivered`. |
| CROSS-002 | contest lifecycle | **PASS with findings F-C1/F-C2/F-C3/F-A1** — admin creates contest via real Go API (201, connect mirror open) → settings+package via BFF admin APIs (voting_settings, contests, connect_contests all synced) → user discovers on web + connect listings → user applies + admin review PROMOTES via the real RPC (no fixture fallback needed) → free vote + wallet-paid vote land → admin transaction surface shows the purchase. Four defects pinned (below). |
| CROSS-003 | user→user transfer | **PASS** — phone resolve (masked, 404 unknown, 409 ambiguous) → transfer 201 → balanced journal (DR sender/CR recipient, fee 0 ≤₦5k) → both wallet projections correct → replay `already_processed` 200, no second debit → self-transfer 422, over-balance 402, tier-0 403 `wallet_disabled` → recipient cannot send 1 kobo more than held (402 `insufficient_funds`) and CAN send what it holds (B→A 201). |
| VOTE-001 | paid-vote crediting atomicity (AUD-DB-002) | **REMEDIATED on the live rail** — tx row `successful|credited`, `votes` row `paid|12|confirmed`, wallet debited exactly once, totals 10+2, replay heals and never double-debits, insufficient-funds refusal leaves zero rows, `uq_votes_paid_transaction` unique index present, zero credited-without-votes rows. Residual design note F-V1. v2 bridge route flag-gated off (see blockers). |
| VOTE-002 | `/vote-callback` (AUD-FE-007) | **RESOLVED** — browser run proves `{transactionId, paymentReference}` is POSTed to `/api/v2/votes/paid/verify`; `trxref`-only callback still submits and the server resolves transactionId by `payment_reference` (proof: reference-only POST against a seeded pending row reached PSP-verify → 400 "Payment verification failed", not "Transaction not found"); bare URL renders Missing Payment Reference and never calls verify. |
| CROSS-004 | audit continuity | **PASS with findings F-A1/F-A2/F-A3** — `user.suspend`, `user.unsuspend`, `user.role.assign` rows carry admin actor + target (AUTH-007 holds on the RBAC surface); `free_vote_cast` lands in `vote_audit_logs` attributed to the voter; `contest.openmic.create` persists but with NULL actor; wallet transfer and order-status mutations write NO durable audit row at all. |

## Findings

- **F-C1 — P2: admin + public leaderboard permanently empty.**
  `getLeaderboard` selects `contestant_share_links ( share_code, share_url )`
  embedded on `vote_totals` — there is no FK between the tables, PostgREST
  returns PGRST200, and the service swallows it: `if (error || !data) return []`
  (`frontend-web/src/server/voting/totals.service.ts:138,146`). Admin
  `GET /api/admin/voting/:contestId/leaderboard` returns `leaderboard: []` even
  with confirmed votes present (verified live: 2 vote_totals rows, empty
  leaderboard). Repro: vote on any contest → call the leaderboard endpoint.

- **F-C2 — P2: `increment_vote_totals` fragments `vote_totals` rows when
  `round_id IS NULL`.** The RPC's `ON CONFLICT (contest_id, contestant_id,
  round_id)` (`supabase/migrations/20260602110000_voting_rpc_functions.sql:51`)
  never matches because NULLs are distinct — every vote insert creates a NEW
  totals row instead of accumulating. Verified live: one contestant, 2
  `vote_totals` rows after free+paid votes. Leaderboard/counter consumers that
  expect one row per contestant read a shard, not the total.

- **F-C3 — P1 (visibility defect): promoted contestants are invisible on the
  public roster and vote page.** `promote_registration_to_contestant` writes
  ONLY `contestants.connect_contest_id` (resolved via `connect_contests.slug`)
  and leaves `contestants.contest_id` NULL
  (`supabase/migrations/20260812010000_registration_contestant_seam.sql:101-104`),
  while every public surface filters `contestants.contest_id`:
  `app/api/v1/contests/[id]/contestants/route.ts` (`eq('contest_id')`) and
  `app/api/vote-page/route.ts:67,81`. Verified live: the real
  admin-review→promote produced contestant `bc032ba2…` with
  `contest_id=NULL, connect_contest_id=<contest>`; the roster endpoint returned
  `[]`. Votes still land (vote paths key on `contestants.id`), so a contestant
  can accumulate votes while being undiscoverable by voters. The backfill
  trigger `trg_default_connect_contest_id` copies `contest_id →
  connect_contest_id` only — never the reverse.

- **F-A1 — P2 (AUTH-007 breach): `contest.openmic.create` audit rows have NULL
  `actor_user_id`.** `CompetitionHandler.emitAudit` reads
  `middleware.GetAuthenticatedUser(c)` (`backend/internal/handlers/
  engagement_handlers.go:189-197`), but the `adminGroup` chain —
  `RequireAdmin` + `RequireAdminConsoleRole` (`internal/app/router.go:269-290`)
  — never populates that context. Every open-mic creation is attributed to
  nobody. Contrast: the RBAC user surface (`user.suspend`, `user.role.assign`)
  IS fully attributed — the gap is specific to this route group.

- **F-A2 — P2: wallet transfers write no durable audit row.**
  `transfers.Service.audit` is `log.Printf` to stdout
  (`backend/internal/finance/transfers/service_ext.go:15-16`). A successful
  ₦100 transfer left 0 `audit_logs` rows — the ledger entries are the only
  durable record. Money mutations emit a log line, not an audit event.

- **F-A3 — P2: order status transitions write no durable audit row.**
  `recordOrderEvent` is a TODO no-op stub
  (`backend/internal/restaurant/service.go:1544-1550`). A real
  `pending→confirmed` transition left 0 `audit_logs` rows for the order.

- **F-V1 — P3 (residual, VOTE-001):** the wallet paid-vote path is
  compensation-based, not single-transaction atomic: `creditWalletVotes`
  inserts the credited `vote_transactions` row, THEN the `votes` row, and
  reverses the wallet debit only if the insert throws. Between-process kill in
  that window is covered by the replay-heal + unique index (verified), so the
  original AUD-DB-002 symptom (credited-forever-without-votes, replay reports
  success without fulfilling) is closed. Note only: it is sequential
  compensate-on-failure, not a single DB tx.

- **Note (env, not a defect):** `POST /api/v2/votes/wallet` → 403 "Wallet
  voting is not enabled" — `FEATURE_VOTE_BRIDGE_ENABLED`/bridge flag off
  (`app/api/v2/votes/wallet/route.ts:67-69`,
  `src/server/voting-bridge/feature-flag.ts:12-21`). The remediated bridge
  credit path could not be exercised live; its code was inspected
  (server-side `priceWalletVote`, Go `/api/finance/vote-bridge/debit`,
  `creditWalletVotes`, `markVotePurchaseReversed`, bound idempotency keys)
  and implements the same compensate-on-failure contract as v1 plus
  KYC-tier + rate-limit gates.

## Journey details

### CROSS-001 — order completion + escrow release — PASS
Owner `POST /api/v1/restaurant` 201 → KYB PUT + submit → admin
`POST /api/restaurant/admin/onboarding/:id/approve` 200 → `is_open=true` →
menu category 201 + item 201 (₦1,500). Fixture: rider seeded
`drivers(status=online, verification_status=approved)`; customer tier-1 +
wallet funded ₦5,000 (journal fixture).

Customer `POST /api/v1/restaurant/:rid/orders` → **201**, `orders.status=
'pending'`, `total_kobo=220000` (150,000 item + 50,000 delivery + 20,000
packaging), escrow journal `escrow:order:<id>` DR `user_wallet` 220,000 /
CR `escrow` 220,000 — balanced.
Customer PATCH status → **403** (customer can't drive provider FSM).
Owner PATCH `confirmed` → 200, `preparing` → 200 — customer's own Go read
`/api/finance/restaurant/orders/:id` tracked each state. Owner PATCH `ready`
→ 200: `pickup_code`/`delivery_code` generated (4-digit), `dispatch_status=
'searching'`, settlement still `escrowed`, offer row `offered` to OUR rider.

Rider feed `GET /api/finance/restaurant/rider/offers` lists the order;
owner-token accept → **400** (wrong actor). Rider `POST .../orders/:id/accept`
→ 200 → `orders.rider_id` set. Wrong pickup code → **400**, status stays
`ready`; correct code → 200 `picked_up`; delivery code → 200 `delivered`.

**Escrow released on delivery** (the carried-over question): settlement
`escrowed → settled`; `settle:order:<id>:*` journal balanced at 220,000 and
decomposed exactly: DR escrow 220,000 → CR provider 180,000 / CR rider 20,000
/ CR `paymax_revenue` 20,000. That is `gross = 220,000 − 20,000 packaging =
200,000`, platform ⌊10%⌋ = 20,000, rider ⌊10%⌋ = 20,000, provider remainder
180,000 (provider leg includes the 100% packaging pass-through). Owner and
rider wallet projections equal their legs. Admin feed
`GET /api/restaurant/admin/orders?restaurant_id=` shows `delivered`.
**Nothing remains parked in escrow — no stuck-funds finding.**

### CROSS-002 — contest lifecycle — PASS with findings
Admin `POST :8080/api/v1/admin/competitions/open-mic` → **201**
(`E2E Cross Open Mic 33331`, slug `e2e-cross-open-mic-33331`); connect mirror
row `open`. User-token create → 401/403 (RBAC negative).

Admin `POST /api/admin/voting/settings` 200 → `voting_settings
active|voting_enabled|paid|free = true|true|true`, `contests.voting_enabled=
true, vote_price_ngn=100`, `connect_contests.paid_vote_kobo=10000`. Admin
`POST /api/admin/voting/packages` → 201 (10 votes + 2 bonus, ₦1,000).

User discovery: `GET /api/v1/contests?search=` lists it; Go
`GET /api/v1/connect/contests` `{data:[…]}` contains the id.

Applicant `POST /api/registration/applications` → draft `registrations` row;
`PATCH .../applications/:id` `stepKey='review_submit'` persists the consent
values the promote gate requires (real contests build the default form —
`media.rightsConfirmed`, `publicProfile.publicVotingConsent`; values merge
verbatim into `form_data`); admin `POST .../applications/:id/review
{status:'approved'}` → **the real promote ran** — `registrations.status=
'approved'`, contestant created by `promote_registration_to_contestant` with
`connect_contest_id` set, `contest_id` NULL (→ **F-C3**: the public roster
returned `[]` for it; pinned, not failed).

Voter: free vote `POST /api/v2/votes/free` → 200 `votesAdded:1`,
`votes` row `free|confirmed`. Wallet vote `POST /api/votes/paid/wallet`
(wallet fixture-funded ₦3,000, tier-1) → **201** `votesCredited:12`,
`vote_transactions` `successful|credited` ₦1,000, `votes` row `paid|12`,
wallet 300,000→200,000, WVOTE journal DR `user_wallet` 100,000,
`vote_audit_logs` `wallet_vote_credited` attributed to the voter.

Admin read-back: `GET /api/admin/voting/:contestId/transactions` → 200 shows
the successful purchase. Leaderboard → **F-C1** (empty despite votes).
`vote_totals` → **F-C2** (2 rows, NULL round_id never conflicts).
`audit_logs` `contest.openmic.create` row exists → **F-A1** (actor NULL).

### CROSS-003 — user→user transfer — PASS
Fixture: both users tier-1 + `user_profiles.phone` set; sender funded ₦5,000.
`GET /api/finance/transfers/paymax/resolve?phone=` → 200 `user_id` =
recipient, **masked phone only** (full number never in the response);
unknown phone → 404.
`POST /api/finance/transfers/paymax` ₦2,000 → **201** `successful`,
`fee_kobo=0` (≤₦5,000 free band), `reference=ww-…`; wallet projections
sender 500,000→300,000, recipient 0→200,000; journal DR 200,000 = CR 200,000;
`wallet_transfers` row `successful` sender→receiver.
Replay same idempotency key → 200 `already_processed`, still exactly one
transfer row, balances unchanged.
Negatives: self-transfer → 422 `self_transfer_not_allowed`; over-balance →
402/403 (tier cap preflights before balance); tier-0 → 403 `wallet_disabled`;
duplicate-phone resolve → 409. Recipient B cannot send 200,001 (402
`insufficient_funds`) but CAN send ₦500 back to A (201, balances moved).
Recipient can never reverse or spend funds it does not hold.

### VOTE-001 — paid-vote atomicity re-verify — REMEDIATED on v1
`POST /api/votes/paid/wallet` → 201 `transactionId … votesCredited:12
amountKobo:100000`; `vote_transactions` `successful|credited`, `votes` row
`paid|12|confirmed`, wallet 500,000→400,000, totals `paid_votes=10,
bonus_votes=2`. Replay same `Idempotency-Key` → 200 `alreadyProcessed:true`,
same transactionId, still 1 votes row, balance unchanged, totals not
double-counted. Insufficient-funds voter → 402, **zero** transaction and vote
rows. Backstop: `uq_votes_paid_transaction` index exists; 0
credited-without-votes transactions. v2 bridge route probed → 403 flag-gated
(env note above).

### VOTE-002 — /vote-callback contract — RESOLVED
`app/vote-callback/page.tsx` reads `reference`/`trxref` + `transactionId`.
Browser run `/vote-callback?reference=R&transactionId=T` → POST to
`/api/v2/votes/paid/verify` carries BOTH fields (the field AUD-FE-007 reported
missing is now forwarded). `/vote-callback?trxref=R` (no transactionId) still
submits with `transactionId:''` — and a reference-only POST against a seeded
pending `vote_transactions` row resolved it and reached PSP verification
(400 "Payment verification failed" — Paystack unreachable locally, expected),
proving the server-side `payment_reference → transaction` fallback runs
before bridging. Bare `/vote-callback` renders "Missing Payment Reference"
and never calls verify.

### CROSS-004 — audit continuity — PASS with findings
Admin `PATCH /api/admin/users/:id/suspend` 200 → `audit_logs` row
`actor=admin fixture, target=user, user.suspend|users`; unsuspend →
`user.unsuspend` row; `POST /api/admin/users/:id/roles` 200 →
`user.role.assign|rbac` attributed. AUTH-007 attribution holds on the RBAC
admin surface.
Contest create → `contest.openmic.create` row exists, correct
action/module/resource — actor NULL (**F-A1**).
User free vote → `vote_audit_logs` `free_vote_cast|vote` actor=voter,
actor_role=voter.
User wallet transfer → money moved, **0 audit_logs rows** (**F-A2**).
Provider order `pending→confirmed` → **0 audit_logs rows** (**F-A3**).

## Coverage ledger — API paths exercised this run

- BFF (:3000): `POST /api/auth/register`, `POST /api/auth/login` (fixture auth);
  `POST /api/v1/restaurant`, `GET /api/v1/restaurant/mine`,
  `POST /api/v1/restaurant/:id/menu/categories|items`,
  `POST /api/v1/restaurant/:id/orders`,
  `PATCH /api/v1/restaurant/:id/orders/:orderId/status`;
  `GET /api/v1/contests`, `GET /api/v1/contests/:id/contestants`;
  `POST|PATCH /api/registration/applications[/:id]`,
  `POST /api/admin/registration/applications/:id/review`;
  `POST /api/admin/voting/settings`, `POST /api/admin/voting/packages`,
  `GET /api/admin/voting/:contestId/transactions|leaderboard`;
  `POST /api/v2/votes/free`, `POST /api/votes/paid/wallet`,
  `POST /api/v2/votes/wallet` (403 probe), `POST /api/v2/votes/paid/verify`;
  page `/vote-callback` (3 shapes).
- Go (:8080): `GET|PUT /api/finance/restaurant/:id/kyb[/submit]`,
  `POST /api/restaurant/admin/onboarding/:id/approve`,
  `GET /api/restaurant/admin/orders`,
  `GET /api/finance/restaurant/orders/:id`,
  `GET /api/finance/restaurant/rider/offers`,
  `POST /api/finance/restaurant/orders/:id/accept|pickup|handoff`,
  `GET /api/finance/transfers/paymax/resolve`, `POST /api/finance/transfers/paymax`,
  `POST /api/v1/admin/competitions/open-mic`, `GET /api/v1/connect/contests`,
  `PATCH /api/admin/users/:id/suspend|unsuspend`, `GET /api/admin/roles`,
  `POST /api/admin/users/:id/roles`.
- DB verification planes: `ledger_entries`/`wallet_balance`,
  `settlements`, `orders`, `restaurant_delivery_offers`, `drivers`,
  `contests`/`connect_contests`, `registrations`, `contestants`,
  `votes`, `vote_transactions`, `vote_totals`, `wallet_transfers`,
  `audit_logs`, `vote_audit_logs`.

## Fixture setup (psql — NOT product flow)

- Wallet funding journal: DR `provider_clearing` / CR `user_wallet`, unique
  idempotency keys — the same balanced pair the Paystack top-up webhook posts.
- `user_profiles.kyc_tier` (no local KYC provider), `user_profiles.phone`
  (recipient resolution keys on it), `drivers` rider row (no local rider
  onboarding), `vote_transactions` pending row (VOTE-002 reference-fallback
  model).
- CROSS-002 needed **no** psql contestant seed this run — the real
  review→promote seam worked end-to-end.

## Blockers / notes for next run

- Paystack is unreachable locally (`PAYSTACK_*` placeholders) → PSP-funded
  paid votes and card checkout remain unverified E2E; wallet rail verified.
- `/api/v2/votes/wallet` is flag-gated off (`FEATURE_VOTE_BRIDGE_ENABLED`)
  → the remediated bridge credit path is inspect-only in this env.
- Admin order feed exercised via the Go admin API (`/api/restaurant/admin/
  orders`); the :3001 console UI was not needed for this suite.
- Leaderboard (F-C1) and vote_totals fragmentation (F-C2) mean admin/public
  tally surfaces cannot be trusted for totals — consumers must aggregate
  `votes`/`vote_transactions` until fixed.
- Golden-path regression re-run after this suite: `npm run test:regression`
  → 10 specs / 131 tests, all green. No app source was modified by this
  task — every change is confined to `frontend-web/tests/e2e/cross/` + this
  file.
