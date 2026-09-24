# Crowdfunding — Phase 2 Addendum (2026-09-16)

Read `crowdfunding.md` first — this file only corrects what has changed since it was
written and adds cases for what Phase 1 discovery found. It does not repeat anything
`crowdfunding.md` still gets right (§3 unit/FSM coverage, most of §4's CON/AUTHZ/BND/
INV/INT cases, §5's FSM tables minus §5d below, §6's SEC-004..007).

## What `crowdfunding.md` gets wrong now (verified against current code, not assumed)

1. **§6 SEC-003 ("admin group has no RBAC gate") is CLOSED**, not open. `adminext/routes.go:45-46`
   gates every admin route with `middleware.RequirePermission(rbac, "crowdfunding.admin.review")`
   (reads) / `"crowdfunding.admin.decide"` (writes) — landed in `e352d2de fix(crowdfunding-admin):
   require a permission on every admin route`, already on this branch. `routes_authz_test.go` pins
   it. Do not re-litigate as a fresh finding; do re-verify live (`CROWDFUNDING-SEC-003` below) since
   this module's history shows other "fixed" RBAC claims (Wallet's WAL-003, Auth's AUTH-003) turned
   out to be incomplete on live testing elsewhere in this engagement.

2. **§2/§5d's withdrawal description is WRONG.** It describes `SubmitWithdrawal` as filing a
   PENDING-only row with "no money moves," and a separate admin `ApproveWithdrawal` as the sole
   money-path. That was the design until `08a2b51a feat(crowdfunding): BVN-gated campaigns, instant
   wallet settlement, no-approval withdrawals` (2026-08-29, already on this branch, commit message
   read in full). **Current, deliberate design:**
   - `Contribute()` settles the 90/10 split **immediately** on every successful contribution
     (`service.go:150-219`) — donation/GoFundMe-style, not Kickstarter-style. Explicitly accepted
     tradeoff per the commit message: a campaign that later fails to reach goal has no refund path
     for money already settled, since it's already the creator's.
   - `wallet.SubmitWithdrawal` (`wallet/service.go:284-388`) now pays out **immediately** —
     `status='COMPLETED'` on insert, a real `ledger.Debit` against the **creator's own wallet**
     (correct account — the commit explains why debiting escrow would have drained *other*
     campaigns' money). **No admin approval step in this path at all.**
   - The `adminext` withdrawal-approval path (`ApproveWithdrawal`, `DecideWithdrawal`,
     `ListWithdrawals` with a status filter) still exists and is still reachable, but nothing the
     live creator flow creates is ever `PENDING` — so it has nothing to act on today. Its "wrong
     ledger account" bug (self-disclosed in the same `08a2b51a` commit message as "flagged
     separately") **has since been fixed**: `3b0932fd0 fix(crowdfunding): admin withdrawal approval
     debited the wrong ledger account`, already on this branch. Confirm this live rather than trust
     the commit message alone (`CROWDFUNDING-WD-004` below).
   - `ListWithdrawals(ctx, status)` (`adminext/service.go:355-372`) returns ALL statuses when
     `status=""` — so `COMPLETED` self-service withdrawals ARE queryable by the API for after-the-
     fact oversight, unlike a design with zero visibility. **Whether the actual admin-console UI
     queries without a status filter (and so shows them) or defaults to `PENDING` (and so shows an
     admin a permanently-empty queue while real money keeps moving) is unverified — this is the
     single most consequential thing to check live in this module** (`CROWDFUNDING-WD-001` below).

3. **`RefundAll`'s real-world reachability is much narrower than its name/E2E-003 implies.**
   `RefundAll` (`service.go:277-310`) only refunds contributions with `status='escrowed'`. Given (2)
   above, a contribution reaches `escrowed` and STAYS there only if the instant `Settle()` call
   inside the same `Contribute()` request fails (`service.go:203-209`, logged as "needs manual
   sweep" — no such sweep job found in discovery). In the normal/happy path essentially every
   contribution flips to `released` within the same request that created it. So "refund a failed
   campaign's contributors" — the feature's whole stated purpose — is **only reachable through a
   settlement-failure edge case**, not through "campaign didn't hit its goal," which is what a
   product owner would reasonably expect this button to do. Verify empirically
   (`CROWDFUNDING-REFUND-001/002` below) rather than assume `E2E-003` as written in `crowdfunding.md`
   is representative.

## New/updated test cases

| Case ID | Title | Priority | Steps | Expected result |
|---|---|---|---|---|
| `CROWDFUNDING-WD-001` | **Admin console Withdrawals page surfaces COMPLETED self-service payouts, not just an empty PENDING queue** | **P0** | Submit a real withdrawal via `POST /campaigns/:id/withdrawal-request` (instant-completes per current design); load `frontend-admin`'s crowdfunding Withdrawals page; separately call `GET /api/crowdfunding/admin/withdrawals` with no status filter and with `?status=PENDING` | The admin UI must show the completed withdrawal somewhere an admin would actually look — if the page defaults to filtering `PENDING` only, real money is moving with **zero admin visibility in practice**, not just zero pre-approval, and that's a Major/Blocker finding on its own regardless of (2)'s already-accepted design |
| `CROWDFUNDING-WD-002` | Self-service withdrawal is a real money-path with no maker-checker — flag for explicit business sign-off | P0 (process, not code) | N/A — documentation/escalation, not a test to execute | Not an engineering defect (the removal was deliberate and reasoned in `08a2b51a`), but it is a genuine risk-acceptance decision (single-actor, KYC-Tier-1-gated, no second approver, no amount threshold) that this engagement should surface for explicit stakeholder sign-off before go-live, the same way Contest's TS-15 required a human business-owner call this engagement could not self-certify |
| `CROWDFUNDING-WD-003` | Withdrawal payout debits the CREATOR's wallet, not shared escrow | P0 | Submit a withdrawal for campaign A; check ledger entries | DEBIT lands on the creator's own `user_wallet` account, CREDIT on `AccountProviderClearing`; campaign B's (or any other campaign's) escrow balance is untouched |
| `CROWDFUNDING-WD-004` | (Regression check) Admin `ApproveWithdrawal`, if a PENDING row is ever manually seeded, debits the correct account | P1 | Manually insert a `cf_withdrawals` row with `status='PENDING'` (simulating any future code path that might still create one); call admin approve | DEBIT posts against the correct account per `3b0932fd0`'s fix, not shared escrow — confirms the self-disclosed "flagged separately" bug from `08a2b51a` stayed fixed |
| `CROWDFUNDING-REFUND-001` | RefundAll on a campaign with normal (non-failed-settle) contributions refunds nothing | P0 | Active campaign, 2+ successful contributions (normal instant-settle path, now `released`); call `POST /campaigns/:id/refund` | Either 0 contributions refunded (nothing `escrowed`) or the call itself errors — confirms the gap; if the UI/API presents this as "refund the campaign" without this caveat, that's a UX-honesty finding |
| `CROWDFUNDING-REFUND-002` | RefundAll DOES work for a contribution stuck in `escrowed` (settle failure) | P1 | Force a `Settle()` failure for one contribution (e.g. malformed settlement state, or trace the code path without live-forcing if not feasible); call refund | That specific contribution transitions `escrowed`→`refunded`; confirms the mechanism works for its (narrow) actual trigger |
| `CROWDFUNDING-ADMIN-001` | `cf_refunds`/`cf_settlements` admin queues are seed-only, approving moves no money | P1 | Query `cf_refunds`/`cf_settlements` row counts and `created_at`/provenance; if any row exists, approve one via `POST /refunds/:id/approve` and check ledger/wallet balances before/after | Confirms discovery's finding: these tables have no real writer (`adminext/model.go` `IsDemo` field self-documents this); `DecideRefund` (`adminext/service.go:213-247`) only flips status + audit row, never touches the ledger — approving a "refund" here must be proven to move zero real money |
| `CROWDFUNDING-ADMIN-002` | `cf_refund_requests` (contributor "I want a refund" flag) never surfaces to any admin queue | P2 | Contributor calls `POST /contributions/:id/refund-request`; check every admin list endpoint (`/refunds`, `/disputes`, `/compliance/*`) for that row | Confirms it's a dead-end — a real gap (Enhancement severity: a contributor-initiated refund *intent* with nowhere for an admin to see or act on it) rather than a security bug |
| `CROWDFUNDING-SEC-003` | Admin group RBAC gate — live re-verify, not just code-read | P0 | Anonymous request, valid-but-unprivileged bearer token, and a real `crowdfunding.admin.decide`-holding admin — hit `POST /withdrawals/:id/approve` and `POST /refunds/:id/approve` with each | First two → 401/403; third → succeeds. Confirms `e352d2de` holds live, matching this engagement's standing bar (Wallet's WAL-003 was "fixed" in an earlier commit and still broken until live-tested) |

## Priority execution order

1. `CROWDFUNDING-SEC-003` (re-verify the RBAC gate live — cheapest, highest-confidence check first)
2. `CROWDFUNDING-WD-001` (admin visibility into completed withdrawals — the most consequential unknown)
3. `CROWDFUNDING-WD-003`/`WD-004` (correct-account confirmation on both withdrawal paths)
4. `CROWDFUNDING-REFUND-001`/`002` (refund mechanism's real reachability)
5. `CROWDFUNDING-ADMIN-001`/`002` (dead-end admin surfaces — confirm no real money/process impact)
6. Reuse `crowdfunding.md` §4 directly for CON/AUTHZ/BND/INV/INT/SEC-001/002/004-007 (all still accurate)
7. `WD-002` is not something to execute — surface it in the module sign-off summary as a decision
   item, the way Contest's TS-15 was surfaced rather than silently resolved either way
