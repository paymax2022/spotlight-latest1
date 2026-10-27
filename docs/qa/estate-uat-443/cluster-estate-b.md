# Estate UAT lane B — M07–M11 (dues, rent/lease, payments, meetings, elections)

Lane: `uat/estate-b` · Worktree `/tmp/uat-estate-b` · Base `f0816a2c4` · 116 cases (EST-UAT-0116..0231)

## Environment (honest limits)

- **No live backend.** `localhost:8080` is an unrelated `rx-api-gateway` container; no spotlight backend is running. `backend/.env` (main checkout) points at `127.0.0.1:54322` — local Supabase is **down** (`supabase status`: no container). `TEST_DATABASE_URL` unset → all `TestLiveDB_*` suites SKIP. **That limit was lifted on 2026-10-26**: the same local database is reachable again, the environment is documented in `live-2026-10-26/README.md`, and the `TestLiveDB` suite ran 60 PASS / 0 FAIL / 0 SKIP against it (EXEC-ESTA-014, `SUMMARY.md`; re-run 2026-10-27 as `E16` in `exec-estate-b.csv`). The one-at-a-time match of that run against this lane's rows is now **done** (Phase 1, 2026-10-27): it converted **0** estate-b rows, because every assertion in those 60 tests is about the dues/meetings/vote/escrow mechanics that lane-b's FAILED rows already describe as defective, not about the behaviours this lane's NOT_RUN rows expect. See the Phase 1 harvest section of `SUMMARY.md`. Phase 2.1 (2026-10-27) then converted 2 rows by **building** the missing check rather than re-reading old evidence: the secret-ballot schema split landed as `supabase/migrations/20271099000010_estate_election_secret_ballot.sql`, and `0213`/`0216` now pass on `E17`–`E19`. Phase 2.2 (same day) converted **15** more, all of M11's governance rows, by building the subsystem they describe (`E20`–`E23`).
- Executed evidence is therefore: `go build` (OK), `go vet` (OK), `go test` unit suites (all PASS), `npx vitest run tests/unit/estate` (48 PASS incl. 12 new), `npx tsc --noEmit` (clean), and structured code review.
- The 6 rows now marked `BLOCKED` are blocked by product or ownership, **not** by environment: `0127` (vacuous — there is no waiver endpoint to abuse), `0132` and `0153` (feature gap: no arrears aging buckets, no partial escrow deductions), `0134` (feature gap: `_Maintenance_OverdueNotifies` proves an overdue notice exists, but there are no due-date reminder keys to schedule), `0165` and `0178` (platform-owned webhook HMAC and payout batching, `ESTB-D010`).

## Result tally (counted from `rtm-estate-b.csv`, 2026-10-27)

| Module | Cases | PASSED | FAILED | BLOCKED | NOT_RUN |
|---|---|---|---|---|---|
| M07 — Dues, levies & assessments | 22 | 0 | 2 | 3 | 17 |
| M08 — Rent, lease & landlord | 22 | 6 | 1 | 1 | 14 |
| M09 — Payments, ledger, refunds & settlement | 26 | 14 | 2 | 2 | 8 |
| M10 — Meetings & minutes | 16 | 8 | 0 | 0 | 8 |
| M11 — Voting, polls & estate elections | 30 | 29 | 0 | 0 | 1 |
| **Total** | **116** | **57** | **5** | **6** | **48** |

`NOT_RUN` is used where the lane recorded no check at all — neither code review
against the case's expectation nor an execution — and it is the largest outstanding
item in this pack. The lane's own executions are `E0`–`E23` in `exec-estate-b.csv`;
`E15` blocked exactly these suites (`PayDues` happy/concurrent, meetings FSM, vote
concurrency, escrow resolve, `putIntent`) on 2026-10-21 because `TEST_DATABASE_URL` was
unset, and `E16` re-ran them successfully on 2026-10-27 once the local database was
reachable. Matching each test to the case it would actually settle (Phase 1) left this
lane's counts at 40 PASSED: no NOT_RUN row here is settled by an existing executed
check, so all 63 need new checks in Waves 4–5. `0134` was corrected from `NOT_RUN` to
`BLOCKED` in the same pass because the live-DB maintenance test does prove an overdue
notice path exists while the due-date reminder the case asks for does not.

**Phase 2.1 (2026-10-27) took this lane to 42 PASSED / 5 FAILED, and it did not come from
the existing run.** The two P0 secret-ballot rows were `FAILED` because the schema itself
stored voter→choice in one row, so the split was built: `election_ballots` holds the
anonymous choice with no voter column and no timestamp, `election_votes` is now a
participation registry whose `candidate_id` is NULL, and one atomic `estate_cast_vote()`
writer is shared by the Go service and the BFF. `0213` and `0216` are PASSED on `E17`
(live-DB re-run 61 top-level PASS / 30 subtests / 0 FAIL / 0 SKIP in 83.969s, log
`live-2026-10-26/livedb-estate-suite-phase2.1.log`) including a new test that asserts the
voter→choice join is impossible, not merely unused. `0221` (abstain) became `PARTIAL`: the
nullable ballot row and abstention-aware tally exist, the abstain API/UI does not. The 63
`NOT_RUN` rows are untouched — none of them is settled by anything in this suite.

**Phase 2.2 (2026-10-27) took this lane to 57 PASSED / 5 FAILED by building the missing
subsystem, and it moved 15 M11 rows at once.** Before this slice the election domain had a
ballot and an eligibility switch and nothing else: an election went straight to `open`,
candidates were whatever the create call listed, and there was no roll, no nomination,
no quorum, no tie-break, no complaint, no recount, no cancellation and no poll type. Each
of those was a separate P0/P1 row that could not be harvested from existing evidence, so
they were built as one governance workflow: additive migration
`supabase/migrations/20271099000020_estate_election_governance.sql` (`E20`, applied and
re-applied idempotently against the local database — 7 new tables, 12 new `elections`
columns, a wider status CHECK that adds `cancelled`, `election_votes.unit_id` behind two
partial uniques, and `estate_cast_vote` upgraded to a 4-arg writer with a 3-arg delegating
form), `backend/internal/estate/election_governance.go` + its handler and the 29
estate-scoped governance routes they expose, the admin console `frontend-admin/app/admin/estate/elections/_governance.tsx`, and
the mobile/BFF half of abstention + per-unit ballots. Verified live by `E21` (13
top-level PASS / 3 tie-break subtests / 0 FAIL / 0 SKIP in 26.694s, log
`live-2026-10-26/livedb-governance-phase2.2.log`) and `E22` (frontend-web 146 estate tests,
admin console transport 8 tests, mobile voting 49 tests, both TS projects clean,
`go build`/`vet` clean). Ballot secrecy from 2.1 is the constraint that shaped every
design choice here: the roll names residents (a published roll is not a ballot), turnout
and recounts aggregate only, and `unit_id` was added to the participation table — which
stores no choice — so a multi-unit holder can vote once per holding without any call
re-linking a voter to a selection. `0222` (ranked / multi-seat) is deliberately still
`NOT_RUN`: tabulating either requires the counter to know a voter's ordered or repeated
selections, i.e. the exact link `0216` (PASSED) forbids, so it needs a sealed-tabulation
decision rather than another field. The BFF bypass that this slice surfaced is recorded as
`ESTB-D015` rather than quietly re-marked.

## M07 — Dues, levies & assessments (22 cases: 0 impl-full, ~6 partial, 16 missing)

Exists and hardened: ad-hoc `CreateInvoice` (category enum, admin-only, kobo validation), `ListInvoices` (resident-scoped), `PayDues` wallet path (Idempotency-Key fail-closed, tier gate in-tx, FOR UPDATE invoice lock, partial-unique ON CONFLICT — PROPMGMT-013 fix VERIFIED intact), `PayDuesPaystackFunded` (verified-amount cross-check), soft/hard `estate_dues_restrictions` (lifted on payment), `MarkOverdueInvoices` + `AutoApplyOverdueRestrictions` maintenance jobs, platform reconciliation read (`/estate-admin/dues/reconciliation`).

Missing: dues-type entity with frequency/GL/eligible-payer rules (0116), batch assessment runs monthly/annual with cycle idempotency (0117/0118/0123), unit-type tariffs + effective dating (0119/0121), vacant discount (0120), one-off levy targeting (0122), penalty/grace engine (0124/0125), waiver workflow (`waived` status exists; no setter) (0126/0127), liability split (0128), partial/over-payment handling — both paths enforce exact amount (0129/0130), disputes (0131), aging buckets (0132), bulk import (0133), scheduled reminders (0134), statements (0135), write-offs (0136), locked periods (0137).

## M08 — Rent, lease & landlord (22: ~4 implemented, ~5 partial, 13 missing)

Exists: `realtor_leases` funnel (application→lease, tenant e-sign + `signed_at` + signature name — 0139), unsigned-lease gating (invoice only created at sign; `active` only via verified payment — 0140), single annual rent+deposit+service-charge invoice at signing (0143), `realtor_pay_invoice` hardened (verified wallet debit, service_role only), inspection-gated escrow release/forfeit via `ResolveEscrow` (all-or-nothing, audit-logged — 0153 partial/0154), tenancy requests + landlord/tenant assignment + transfer requests (0155 partial), RLS tenant scoping (0156), rent/dues table+ledger separation (0159).

Missing: direct lease registration outside application funnel (0138), overlap detection (0141), recurring monthly invoicing (0142), proration (0144), due-date/grace/late-fee engine + cap (0145/0146), partial & split payments (0147/0148), adjustments (0149), renewal (0150), expiry notifications (0151), early termination (0152), partial deposit deductions (0153), arrears follow-up (0158), PAYSTACK channel for rent (0161 — 501 disclosed gap, ESTB-D009).

## M09 — Payments, ledger, refunds & settlement (26: ~16 pass, ~4 partial, 6 missing)

Strong: `estate/paystackcheckout` (quoted-amount freeze, intent dedup by idempotency key, `ClaimForProcessing` single-claim, verify-then-pay, amount-mismatch→refund, failure→refund, self-heal `CheckStatus`) — unit-tested. Wallet dues path idempotent end-to-end. NEW: BFF cross-idempotency-key double-charge race closed on both dues and realtor paths (ESTB-D004/D005), foreign-key replay → 409.

Missing/partial: resident refund request + approval flow (0175/0176), combined dues+rent checkout (0172 partial — separate ledgers exist), fee disclosure (0173), gateway/bank payout destination verification (0180 — payouts are wallet credits), reconciliation exception listing beyond billed/collected variance (0182 partial), daily cash ledger tie-out (0183), general reversal-with-approval flow outside escrow resolve (0185 partial). Webhook signature/dup-delivery at the platform seam is platform-owned (0165 recorded shared_platform).

## M10 — Meetings & minutes (16: ~7 pass, ~4 partial, 5 missing)

Exists: create/list/get (resident-scoped, BFF + Go), RSVP upsert yes/no/maybe + counts, attendance check-in unique per (meeting,user), start/end/cancel/reschedule FSM (admin, audited), minutes upload + approve (re-upload un-approves), meeting documents, estate-scoped isolation.

Missing: committee-only audiences (0187), per-invitee invites (0188 partial — broadcast notify), quorum gating (0195), task-linked action items + overdue follow-up (0197/0198), export (0200). Note ESTB-D008: BFF `POST /api/v1/estate/meetings` allows any resident (mobile ships a create screen) while Go `CreateMeeting` is estate_admin — inconsistent, needs product decision.

## M11 — Voting, polls & estate elections (30: 29 PASSED, 1 NOT_RUN)

Exists + hardened this lane: draft create (Go; the BFF still writes `open` directly — `ESTB-D015`), single-position ballot, one-vote enforcement (`UNIQUE(election_id,voter_id)` until Phase 2.2 replaced it with two partial uniques — one row per voter, or one per unit when the election is weighted that way), server-side window enforcement, `election_eligibility_rules` (KYC/payment/resident-types) + dues-restriction gate — **now enforced on the BFF path too (ESTB-D001, was completely bypassed)**, banned/deleted members fail closed (ESTB-D002), sealed receipts + pre-publish tally withholding (ESTB-D006), **secret-ballot schema split (ESTB-D003/D011, Phase 2.1): `election_ballots` stores the anonymous choice (no voter column, no timestamp — a copied `cast_at` would be a join key rebuilding the link the split exists to break), `election_votes` carries participation only, `estate_cast_vote()` is the single atomic writer for both the Go service and the BFF, and all four read paths count ballots**, admin integrity audit (ballots vs distinct voters, now deliberately cross-table), certified publish (`tallied`), cross-estate isolation, and — Phase 2.2, `ESTB-D014`, `E20`–`E22` — the workflow that surrounds a ballot: rule proposals decided by a second actor and then locked, a versioned electoral roll that is built → frozen → challengeable, with removal and named exceptions able to revoke the right to vote mid-poll, nominations that a member raises and only the nominee accepts before an admin vets and certifies it onto the ballot, per-unit ballot weighting, quorum and tie-break rules that gate certification, complaints that block certification until resolved plus aggregate-only recounts, cancellation as an audited terminal state that seals the ballot, and non-binding polls.

Missing after Phase 2.2: only ranked & multi-seat ballots (0222) — and that is now a decision, not a backlog item: either tabulation needs the counter to know a voter's ordered or repeated selections, i.e. the persisted voter→choice link that 0216 (PASSED) forbids, so it requires a sealed-tabulation design rather than another column. Two disclosed gaps sit beside the closed rows rather than inside them: the audit **export** (0228 stays PARTIAL — the aggregate surfaces are complete and contain no per-voter choice, a downloadable artefact still does not exist; deferred to the Phase 5 reporting cluster) and the BFF create path (`ESTB-D015` — `POST /api/v1/elections` still writes `status='open'`, so an election created from the app cannot enter the governance workflow). The schema-level voter→choice link that made 0213/0216 fail is **closed** (Phase 2.1, `E17`–`E19`), and the workflow that left 0202–0230 `NOT_RUN` is **built** (Phase 2.2, `E20`–`E22`).

## Defects

| ID | Sev | Status | Summary |
|---|---|---|---|
| ESTB-D001 | S1 | FIXED | BFF vote ignored eligibility rules + dues restrictions |
| ESTB-D002 | S2 | FIXED | BFF getResidentContext ignored banned/deleted members |
| ESTB-D003 | S2 | FIXED (Phase 2.1, `c4c69e0cd`) | Ballot secrecy: receipt echo sealed, and the schema voter→choice link removed by the `election_ballots` split |
| ESTB-D004 | S1 | FIXED | Dues BFF cross-key double-debit race (no atomic claim) |
| ESTB-D005 | S1 | FIXED | Realtor BFF same race + foreign-key receipt misattribution |
| ESTB-D006 | S2 | FIXED | Live tally exposed to all residents mid-poll |
| ESTB-D007 | S3 | FIXED | Admin arrears join used resident row id → always ₦0 |
| ESTB-D008 | S3 | recorded | BFF meeting-create open to residents vs Go admin-only |
| ESTB-D009 | S3 | recorded | Realtor PAYSTACK channel unimplemented (501) |
| ESTB-D010 | S3 | shared_platform | Webhook signature/dup handling is platform-owned |
| ESTB-D011 | S2 | FIXED (Phase 2.1, `c4c69e0cd`) | Secret-ballot schema split: voter→choice unlinkability |
| ESTB-D012 | S3 | RECORDED | No partial/over-payment support on dues or rent (owned by Phase 4) |
| ESTB-D013 | S3 | FIXED (Phase 2.1, `c4c69e0cd`) | Resident election tally 500s on a candidate with NULL bio (`cannot scan NULL into *string`) — found by the new ballot test, not by a test written for it |
| ESTB-D014 | S2 | FIXED (Phase 2.2, `c4c69e0cd`) | Election governance workflow absent: no rule approval, no roll/challenge, no nominations, no per-unit weighting, no quorum/tie-break, no complaint/recount, no cancellation, no poll type — 15 rows, built in `E20`–`E22` |
| ESTB-D015 | S3 | RECORDED | BFF `POST /api/v1/elections` writes `status='open'`, so an app-created election can never enter the governance workflow (every governance verb refuses a non-draft) — needs a product decision, not a silent re-point |

See `defects-estate-b.csv` for full root causes; `rtm-estate-b.csv` for all 116 rows; `exec-estate-b.csv` for every executed check. `migrations-estate-b/` now holds only the superseded ballot-split draft — it was promoted and applied to the local database on 2026-10-27 (`E18`) as `supabase/migrations/20271099000010_estate_election_secret_ballot.sql`.
