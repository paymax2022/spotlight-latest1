# Estate & Visitor Access (443) — UAT consolidation summary

**Date:** 2026-10-21  |  **Runbook:** `docs/qa/UAT-OCT-2026-RUNBOOK.md`  |  **RTM rows:** 443 / 443 source cases

## Roll-up by lane (snapshot at consolidation, 2026-10-21)

| Lane | Main commit | Rows | Passed | Failed | Blocked | Not run | Needs manual | N/A | Other | Defects (S1/S2/S3/S4) | Fixed |
|---|---|---|---|---|---|---|---|---|---|---|---|
| estate-a | `ff51e2a8d` | 115 | 20 | 0 | 93 | 0 | 2 | 0 | — | 23 (2/12/9/0) | 10 |
| estate-b | `d51071c7d` | 116 | 40 | 7 | 5 | 64 | 0 | 0 | — | 12 (3/4/5/0) | 7 |
| estate-c | `21934eafa` | 116 | 18 | 55 | 41 | 0 | 2 | 0 | — | 18 (0/12/4/2) | 9 |
| estate-d | `db97402fc` | 96 | 41 | 0 | 35 | 0 | 19 | 0 | 1 | 35 (5/17/13/0) | 9 |
| **Total** | | **443** | **119** | **62** | **174** | **64** | **23** | **0** | 1 | 88 | |

`Passed` means an executed check (unit / live-DB integration / live API) per the runbook's evidence rule; code reading alone never yields `Passed`. `Other` = non-schema result values kept verbatim from the lane (`PARTIAL`, `PASSED_D<n>` = passed after that lane's defect fix).

## Post-consolidation re-verification (2026-10-26)

Two findings contradict evidence recorded above.

**1. The "no live environment" premise is obsolete.** estate-a recorded 93 of 115 rows as
`BLOCKED: no live backend/DB in lane env`, yet estate-d's own ledger (EXEC-D-020) had already run
live-DB tests against `localhost:54322` on 2026-10-21 — and that database is reachable again now.
Executed 2026-10-26:

| Command | Result | Ledger row |
|---|---|---|
| `cd backend && TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:54322/postgres' go test -v -count=1 -run TestLiveDB ./internal/estate/` | 60 top-level PASS / 0 FAIL / 0 SKIP in 56.001s (0 SKIP proves `20271087000000_estate_delegation.sql` is applied) | EXEC-ESTA-014, EXEC-D-021 |
| `cd frontend-web && npx vitest run tests/unit/estate` | 12 files / 116 tests PASS / 0 FAIL | EXEC-ESTA-013 |

**2. `fc6fd64f7` silently broke 23 visitor/estate specs** (`ESTA-D027`). The ESTD-D025 write gate
(`assertEstateWritable` in `frontend-web/src/server/estate/resident.ts`) returns 423 unless
`estates.status = 'active'`, but the fixtures behind `visitor-gate-uat`, `facility-booking-conflict`,
`repair-signoff` and `vendor-jobs-authz` carried no `estates` row — so every visitor row that cited
those specs lost its evidence for five days. Repaired by seeding `status: 'active'` in the fixtures
and adding 2 negative 423 specs. Production was never locked out (`estates.status` is
`NOT NULL DEFAULT 'active'`); the ledger was wrong.

### Rows re-marked from executed evidence

| Lane | Case | Was | Now | Evidence |
|---|---|---|---|---|
| estate-a | 0056 gate-only delegation | BLOCKED | PASSED | TestLiveDBGrantRevokeAndExpiry, TestLiveDBGuardAuthzRequiredOnCheckIn |
| estate-a | 0061 role grant authorized | BLOCKED | PASSED | TestLiveDBGrantRevokeAndExpiry, TestLiveDBNewEstateTablesNotReachableViaPostgREST |
| estate-a | 0068 expired temporary assignment | BLOCKED | PASSED | TestLiveDBGrantRevokeAndExpiry (past `expires_at` denies) + read-time filter in `hasLiveGrant` |
| estate-d | 0418 estate verification queue | BLOCKED | PASSED | TestLiveDB_Lifecycle_VerificationQueue |
| estate-d | 0419 suspend estate | BLOCKED | PASSED | TestLiveDB_Lifecycle_Transitions + _ReasonRequiredAndNotFound + the 2 new BFF 423 specs |
| estate-d | 0430 legal data hold | BLOCKED | PASSED | TestLiveDB_Lifecycle_LegalHoldBlocksPurge (service refusal + DB trigger + audit on place/release) |
| estate-d | 0432 customer account migration | BLOCKED | PASSED | TestLiveDB_Import_DryRunCommitAndReplay, _ExceptionsAndGates |
| estate-d | 0433 unit and membership mapping | BLOCKED | PASSED | TestLiveDB_Import_DedupeAndDelta (dedupe onto a native unit, no duplicate after commit) |
| estate-d | 0434 opening dues balances | BLOCKED | PASSED | TestLiveDB_Import_DryRunCommitAndReplay + control-total refusal (`ErrImportControlTotal`) |
| estate-d | 0440 dry-run counts comparison | BLOCKED | PASSED | DryRunImport per-entity Insert/Update/Link/Unchanged counts asserted before any commit |
| estate-d | 0441 migration incremental delta | BLOCKED | PASSED | TestLiveDB_Import_DedupeAndDelta (`estate_import_refs.row_hash`; identical re-apply = Unchanged, one changed row = Update) |
| estate-d | 0421 approval threshold changes | BLOCKED | PASSED | TestLiveDB_DualControl_ThresholdChangeVersionedHistory, _BelowThresholdExecutesDirectly |
| estate-d | 0428 administrator maker-checker | BLOCKED | PASSED | TestLiveDB_DualControl_PayoutSelfApprovalRefused_CrossAdminExecutesOnce, _ConcurrentApproversExecuteOnce, _ResidentBanNeedsSecondAdmin, _RoleGrant |

### API_LIVE lanes (2026-10-26) — a real backend, then a real BFF, over HTTP

The live-DB suite runs the service in-process; these two lanes run the shipped
binaries and make HTTP requests. Environment, identities, seed SQL, scripts and transcripts:
`docs/qa/estate-uat-443/live-2026-10-26/`.

| Lane | Executed | Result | Ledger rows |
|---|---|---|---|
| Go backend with `FEATURE_ESTATE_GUARD_GRANTS=true` (`:8093`), 31 assertions | `04-probe.sh` | 31 PASS / 0 FAIL | EXEC-ESTA-017 |
| same binary, flag **off** (the shipped default, `:8094`) — control | `05-probe-flagoff.sh` | pre-#876 behaviour reproduced: ungranted member reaches the guard surface | EXEC-ESTA-018, ESTA-D021 |
| outsider `GET /api/finance/estate` against both | control pair | `{"data":null}` ON vs the whole estate directory listed OFF | EXEC-ESTA-019, **new ESTA-D024** |
| Next.js BFF `/api/v1/visitor/**` (`next dev` `:3000`), 47 assertions | `06-probe-bff.sh` | 46 PASS / 1 FAIL (the FAIL is a stale open shift left by an aborted earlier run, not product behaviour) | EXEC-ESTA-021 |
| BFF negative probes: guard-role authz, `require_host_approval` | sections I–J of the same script | **both fail as expected-fail**: ungranted resident opens a gate session `201` / reads expected `200` / admits `200`; `requireHostApproval:true` is stored `f` and admitted with no host decision | EXEC-ESTA-022, ESTA-D021/D022 stay open, new ESTA-D025/D026 |

Rows re-marked from the API_LIVE lanes:

| Lane | Case | Was | Now | Evidence |
|---|---|---|---|---|
| estate-a | 0053 least privilege resident | BLOCKED | PASSED | EXEC-ESTA-017 (scoped to the staff-grant mutation set) |
| estate-a | 0062 unauthorized grant escalation | BLOCKED | PASSED | EXEC-ESTA-017 |
| estate-a | 0063 role revocation on a live session | BLOCKED | PASSED | EXEC-ESTA-017 (revoke, then `403` on all three guard surfaces with the same still-valid bearer) |
| estate-a | 0056 / 0061 / 0068 | PASSED | PASSED | evidence upgraded from live-DB tests to EXEC-ESTA-017 over HTTP |
| estate-a | 0073 bulk visitors for event | BLOCKED | PASSED | EXEC-ESTA-021 (event `201`, CSV `201 imported:2`) — new ESTA-D026 for the silent row drop |
| estate-a | 0092 visitor check out | BLOCKED | PASSED | EXEC-ESTA-021 |
| estate-a | 0102 manual code entry | BLOCKED | PASSED | EXEC-ESTA-021 — new ESTA-D025: the id-prefix branch can never match (`uuid ~~*`) |
| estate-a | 0111 guard handover | BLOCKED | PASSED | EXEC-ESTA-021 (handover closes the shift; every guard route then `403`) |
| estate-a | 0112 emergency gate mode | BLOCKED | PASSED | EXEC-ESTA-021, scoped to gate-level emergency admission; estate-wide posture switch still missing |
| estate-a | 0113 plate/driver guest check | BLOCKED | PASSED | EXEC-ESTA-021 |
| estate-a | 0114 tailgating incident | BLOCKED | PASSED | EXEC-ESTA-021 (incident `201`, pass not consumed) |
| estate-a | 0115 gate outage fallback | BLOCKED | PASSED | EXEC-ESTA-021 (full flow with no scanner path) |
| estate-a | 0096 visitor log filtering | BLOCKED | NEEDS_MANUAL | route verified live but has no server-side filter — UI scope |
| estate-a | 0106 offline gate mode | BLOCKED | NEEDS_MANUAL | server half verified (`synced:1`/`synced:0`/`400`); no offline admission policy or client queue exists to execute |
| estate-a | 0101 guard shift sign-in | PASSED | PASSED | evidence upgraded to EXEC-ESTA-021, with the ESTA-D021 membership-only caveat attached |

Deliberately **not** marked passed:

- estate-a 0055/0057/0058/0060 moved `MISSING → PARTIAL` but stay BLOCKED. `finance_officer`,
  `election_officer`, `facility_officer`, `meeting_secretary` and `auditor` are grantable in
  `estate_staff_grants` yet consulted by no action path — `hasLiveGrant` is reachable only through
  `assertGate`, and all 9 of its call sites pass `guardRoles` (EXEC-ESTA-016).
- estate-a 0086–0090, 0104, 0105, 0110 keep `result=BLOCKED` with the true reason: the shipped
  BFF/mobile guard path never reads `require_host_approval`, exposes no resident approve/decline
  action, has no supervisor-override permission and no device binding (EXEC-ESTA-015, now re-proved
  over HTTP by EXEC-ESTA-022 — an ungranted plain resident opened a gate session, read the expected
  list and admitted a visitor; a `requireHostApproval:true` pass was stored `f` and admitted with no
  host decision). Absent code is the blocker, not absent environment.
- EST-UAT-0090 (resident unreachable) stays BLOCKED: `arrivalApprovalTTL` denies a stale *approval*,
  which is not the case's expectation — nothing writes `visitor_arrival_requests.status='timeout'`.
- estate-d 0389 (retention and deletion) stays NEEDS_MANUAL with corrected evidence: the legal-hold
  half of `ESTD-D016` is closed by the same run, but no scheduled purge disposes expired visitor
  records.

### Current counts (2026-10-27, after the Phase 1 evidence harvest)

| Lane | Rows | Passed | Failed | Blocked | Not run | Needs manual | Other |
|---|---|---|---|---|---|---|---|
| estate-a | 115 | 35 | 0 | 76 | 0 | 4 | 0 |
| estate-b | 116 | 40 | 7 | 6 | 63 | 0 | 0 |
| estate-c | 116 | 18 | 55 | 41 | 0 | 2 | 0 |
| estate-d | 96 | 51 | 0 | 25 | 0 | 19 | 1 |
| **Total** | **443** | **144** | **62** | **148** | **63** | **25** | **1** |

### Phase 1 harvest (2026-10-27): the live-DB run does **not** cover estate-b/estate-c

Re-executed `TEST_DATABASE_URL=… go test -v -count=1 -run TestLiveDB ./internal/estate/` →
**60 top-level PASS / 30 subtests PASS / 0 FAIL / 0 SKIP in 116.702s** (log:
`live-2026-10-26/livedb-estate-suite.log`; ledger rows EXEC-ESTA-023, E16, EXEC-C017). Every test
body was then read to build an assertion inventory, and each open row was matched against what a
test *actually* asserts rather than its suite name. Result:

- **1 row converts**: EST-UAT-0054 (manager estate scope) `BLOCKED → PASSED` on
  `TestLiveDBListEstatesIsolation` + `TestLiveDB_PayDues_RejectsCrossEstateInvoice`, with the scope
  written into the row (service layer, estate-list and dues-invoice reads only; no HTTP probe).
- **1 row is corrected rather than passed**: EST-UAT-0134 (dues reminders) `NOT_RUN → BLOCKED`,
  because the run proves a scheduled overdue notice exists (`_Maintenance_OverdueNotifies`) while
  the case's due-date reminder keys still do not.
- **9 rows get executed evidence for their failure**: 0129, 0130, 0147, 0161, 0171 (exact-amount
  enforcement is asserted, so partial/over/transfer payment is provably refused), 0213 and 0216
  (`_Vote_ConcurrentDuplicateVote` asserts `election_votes` still keys `(election_id, voter_id)` with
  `candidate_id`, i.e. voter→choice coupling remains on disk), 0286 (payout gates on
  `vendor_jobs.status=completed` alone — no PO, no invoice match). These stay `FAILED`; the run
  upgrades them from "code review says absent" to "executed test proves the guard".
- The remaining estate-b `NOT_RUN` rows (63) and estate-c `BLOCKED` rows are **not** covered by this
  suite: they assert invite lists, quorum, electoral rolls, document/announcement/procurement
  governance and export surfaces that no test touches. They need new executed lanes (wave 1 HTTP
  probes) or builds (waves 3–5), which is what `CLOSEOUT-PLAN.md` now sequences.

The earlier expectation that "the same 60-test run covers estate-b and estate-c cases" is therefore
**withdrawn** — it was an inference from suite names, and matching row by row did not support it.


The paragraph that used to sit here anticipated that the same 60-test run also covered the estate-b
and estate-c meetings, election, notification, dues and vendor rows once they were matched one at a
time. That matching has now been done (Phase 1, above) and the anticipation did not hold.

### Defect status changes

Counted from `defects-<lane>.csv` on 2026-10-26 (the roll-up table at the top is the
2026-10-21 consolidation snapshot and has not been rewritten):

| Lane | Defects | FIXED | PARTIAL_FIXED | RECORDED | S1/S2/S3/S4 | shared-platform |
|---|---|---|---|---|---|---|
| estate-a | 27 | 11 | 4 | 12 | 2/14/11/0 | 3 |
| estate-b | 12 | 6 | 1 | 5 | 3/4/5/0 | 1 |
| estate-c | 18 | 9 | 0 | 9 | 0/12/4/2 | 0 |
| estate-d | 35 | 10 | 3 | 22 | 5/17/13/0 | 5 |
| **Total** | **92** | **36** | **8** | **48** | **10/47/33/2** | **9** |

`ESTA-D011`, `ESTA-D021`, `ESTA-D022` → `PARTIAL_FIXED` (commit `554173ae0`);
`ESTA-D010` → `PARTIAL_FIXED` (commit `caef65516`; lifecycle machine + review queue exist, draft
state / revision history / ownership transfer / timezone / branding do not);
`ESTD-D025` → `FIXED` (commit `caef65516`, BFF mirror `fc6fd64f7`);
`ESTD-D016` → `PARTIAL_FIXED` (commit `caef65516`; hold gate built, retention sweep not);
`ESTD-D034` → `PARTIAL_FIXED` (commit `caef65516`; importer covers unit/resident/dues-balance only).
`ESTA-D027` → `FIXED` (fixture regression from `fc6fd64f7`; `status: 'active'` seeded in the four
specs and 2 negative 423 specs added — repaired in the working tree, **uncommitted**, so its
`fix_commit` column in `defects-estate-a.csv` is deliberately blank).

Recorded from the API_LIVE lanes, none of them fixed by this work:

- **`ESTA-D024`** (S2, RECORDED) — with `FEATURE_ESTATE_GUARD_GRANTS` at its shipped default the
  estate directory is enumerable: a non-member's `GET /api/finance/estate` returns every
  `status='active'` estate (`id`, `name`, `admin_id`, `created_at`), while the same call
  with the flag on returns `{"data":null}`. Caller-scoped discovery was coupled to the guard-grants
  flag instead of being its own always-on rule.
- **`ESTA-D025`** (S3, RECORDED) — `gate/lookup`'s documented id-prefix branch can never match: the
  filter is `uuid ~~*`, Postgres rejects it (`42883`, reproduced in `psql` and as a PostgREST `404`),
  and the route discards the error, so a broken query is reported to the guard as `found:false`.
- **`ESTA-D026`** (S3, RECORDED) — `POST /codes/import` answered `201 {"imported":2}` for a 3-row
  CSV and said nothing about the dropped row; the insert is also a single batch, so the success
  response implies partial acceptance that the code does not actually implement.

The estate-d import rows that stay BLOCKED for real reasons: `0435` opening rent balances and `0437`
historical voting records have no importer entity, and `0439` has no executed batch containing a
malformed date (`NEEDS_MANUAL`).

### What is still needed to close the pack

1. Turn on and live-verify the flags. **Done for `FEATURE_ESTATE_GUARD_GRANTS`** (EXEC-ESTA-017 with
   the flag on, EXEC-ESTA-018/019 as the flag-off control) — and that work is exactly what produced
   `ESTA-D024`, so the decision is now *whether to ship it on*, not whether it works.
   `FEATURE_ESTATE_LIFECYCLE_ENABLED`, `FEATURE_ESTATE_VERIFICATION_REQUIRED` and
   `FEATURE_ESTATE_IMPORT_ENABLED` still default to `false` and have never been exercised
   over HTTP.
2. Wire host-arrival approval and staff grants into the BFF/mobile surface, or formally record the
   Go routes as the product surface for those cases. The BFF lane narrowed this to two concrete
   edits: authorise `/api/v1/visitor/gate/**` against `estate_staff_grants` (not membership alone),
   and write + read `require_host_approval` in `codes/route.ts`.
3. ~~Seed a demo estate and run the BFF visitor golden path over HTTP~~ — done
   (`live-2026-10-26/`, EXEC-ESTA-021/022); 0073, 0092, 0102, 0111, 0112, 0113, 0114, 0115 converted.
4. Promote the 6 `*.pending.sql` drafts below.
5. `go test -race`, `make verify`, and the mobile Playwright e2e pass still have never been run.
6. ~~Re-mark the estate-b and estate-c rows that the 60-test live-DB run already covers~~ — **done
   2026-10-27 (Phase 1)**, and the answer is: it covers one row. EST-UAT-0054 converted, EST-UAT-0134
   corrected, nine failures hardened by executed tests; the rest need new probe lanes or builds. See
   `CLOSEOUT-PLAN.md` for the wave-by-wave sequence and `closeout-triage.csv` for the per-row plan.

## Open S1/S2 defects (statuses refreshed by the 2026-10-26 re-verification above)

Scope: every S1/S2 defect whose 2026-10-26 status is `RECORDED` or `PARTIAL_FIXED`, plus
`ESTD-D025`, kept listed because its fix sits behind `FEATURE_ESTATE_LIFECYCLE_ENABLED`, which
still defaults to false. Fully fixed S1/S2 defects are only in the per-lane ledgers.

| Defect | Sev | Lane | Title | Status | Platform-owned |
|---|---|---|---|---|---|
| ESTD-D014 | S1 | estate-d | MFA flag is advisory — not enforced for high-risk roles | RECORDED | yes |
| ESTD-D025 | S1 | estate-d | No estate lifecycle state — cannot verify or suspend an estate | FIXED (`caef65516` + BFF mirror `fc6fd64f7`; behind `FEATURE_ESTATE_LIFECYCLE_ENABLED`, default false) | no |
| ESTD-D027 | S1 | estate-d | No maker-checker / approval-threshold controls on admin actions | PARTIAL_FIXED (`fc6fd64f7`: payout/ban/role-grant/threshold covered; vendor-verify and restriction still single-actor; behind `FEATURE_ESTATE_DUAL_CONTROL_ENABLED`) | no |
| ESTD-D028 | S1 | estate-d | No support impersonation surface | RECORDED | yes |
| ESTD-D034 | S1 | estate-d | No legacy-data import/migration tooling for estate | PARTIAL_FIXED (`caef65516`: unit/resident/dues-balance importer with dry-run + delta; rent balances, historic votes and payment rows have no import entity) | no |
| ESTA-D010 | S2 | estate-a | Estate lifecycle & governance schema absent: no draft/publish/verify/deactivate/transfer/tz/branding | PARTIAL_FIXED (`caef65516`: status machine + review queue; no draft/revision history, transfer, timezone or branding) | no |
| ESTA-D011 | S2 | estate-a | Estate role model is binary (resident/estate_admin): no finance/gate/election/facility/auditor/temporary delegations | PARTIAL_FIXED (`554173ae0`: `estate_staff_grants` + fail-closed `assertGate` for guard roles only; the other 5 roles are grantable but enforced nowhere) | no |
| ESTA-D012 | S2 | estate-a | Merchant onboarding lacks withdraw/suspend/reactivate; resubmit only from NEEDS_MORE_INFO | RECORDED | yes |
| ESTA-D017 | S2 | estate-a | QR payload unsigned; no offline cached-credential admission policy | RECORDED | no |
| ESTA-D021 | S2 | estate-a | No per-gate assignment, supervisor-override permission, identity check, or device binding at the gate | PARTIAL_FIXED (`554173ae0`: guard admit authz fail-closed behind `FEATURE_ESTATE_GUARD_GRANTS`; override permission, identity check, device binding and `code.gate` all still absent). Live-confirmed 2026-10-26 (EXEC-ESTA-022) that the **BFF authorises gate work by membership alone** — an ungranted plain resident opened a shift, read the expected list and admitted a visitor | no |
| ESTA-D022 | S2 | estate-a | Resident real-time approval flow absent (approve/decline/timeout) | PARTIAL_FIXED (`554173ae0`: Go has pending/approved/declined + 15-min TTL, live-proven; `timeout` is never written and the BFF/mobile path does not read `require_host_approval`). Live-confirmed (EXEC-ESTA-022): `requireHostApproval:true` is stored as `require_host_approval = f` and the guard admitted it with no host decision | no |
| ESTA-D024 | S2 | estate-a | Estate directory enumerable by any authenticated user while `FEATURE_ESTATE_GUARD_GRANTS` is at its default | RECORDED (found by the EXEC-ESTA-019 control: `{"data":null}` with the flag on vs the full active-estate list with it off) | no |
| ESTB-D003 | S2 | estate-b | Ballot secrecy violated by schema + receipt API | PARTIAL_FIXED (ledger `fix_commit = pending`; participation API sealed, `election_votes` still couples `voter_id` + `candidate_id` — the schema split itself is tracked as ESTB-D011) | no |
| ESTB-D011 | S2 | estate-b | Secret-ballot schema split required (voter->choice unlinkability) | RECORDED | no |
| ESTC-D010 | S2 | estate-c | Fee-based facility booking can never be confirmed: no payment/confirm endpoint | RECORDED | no |
| ESTC-D011 | S2 | estate-c | Booking cancellation has no refund-cutoff policy or ledger refund | RECORDED | no |
| ESTC-D012 | S2 | estate-c | Procurement model absent: no RFQ/bids/contracts/authority-matrix/three-way-match/credential-expiry/ratings/renewals/spend summary | RECORDED | no |
| ESTC-D013 | S2 | estate-c | Document governance absent: versioning/approval/expiration/ack/e-sign/soft-delete/bulk-export/malware-scan/magic-byte-type-check/presign-size-binding | RECORDED | no |
| ESTC-D014 | S2 | estate-c | Announcement governance absent: targeting/draft-approve/scheduling/pin/attachments/edit-history/mandatory-ack/moderation/per-channel delivery tracking | RECORDED | no |
| ESTC-D015 | S2 | estate-c | Incident workflow absent: ack/escalation/geo-target/responder-failover/false-report-control/resident-cancel/update-feed/resolution-evidence/reopen-justification/response-metrics | RECORDED | no |
| ESTC-D016 | S2 | estate-c | Asset & maintenance planning absent: asset tags/registry/warranty/SLA rules/preventive schedules/blackout calendar/meter readings/projects/quote-approval thresholds/closure flag | RECORDED | no |
| ESTC-D017 | S2 | estate-c | Report exports absent: CSV/XLSX/PDF, async jobs, scheduled email, PII minimisation/watermark, data-as-of stamps, rent roll, expense side | RECORDED | no |
| ESTD-D009 | S2 | estate-d | No malware/virus scan stage on uploads | RECORDED | no |
| ESTD-D013 | S2 | estate-d | Non-money-path audit writes are fire-and-forget | RECORDED | no |
| ESTD-D015 | S2 | estate-d | No data-subject access (export) endpoint | RECORDED | no |
| ESTD-D016 | S2 | estate-d | No retention purge or legal-hold gate on visitor/estate records | PARTIAL_FIXED (`caef65516`: legal-hold columns + service refusal + DB delete trigger, live-proven; no scheduled visitor-record purge) | no |
| ESTD-D018 | S2 | estate-d | No report export (CSV/XLSX/PDF) — formula-injection N/A but feature absent | RECORDED | no |
| ESTD-D020 | S2 | estate-d | Platform auth/RLS/session/provider concerns outside lane scope | RECORDED | yes |
| ESTD-D024 | S2 | estate-d | No platform-level provider application queue for estate vendors | RECORDED | no |
| ESTD-D026 | S2 | estate-d | No cross-estate global configuration rollout | RECORDED | no |
| ESTD-D029 | S2 | estate-d | User disable does not trigger gate-shift handover | RECORDED | no |
| ESTD-D033 | S2 | estate-d | No suspicious-access-denied aggregation/alerting | RECORDED | no |
| ESTD-D035 | S2 | estate-d | No formal rollback path/tooling beyond additive-only policy | RECORDED | no |

## Pending schema changes (NOT applied)

Per runbook rule 5, lanes wrote no migrations. These drafts still need review (additive-only, version-collision check) before being promoted into `supabase/migrations/` and replayed with `supabase db reset`:

- `estate-uat-443/migrations-estate-a/estate_properties_unique_unit.pending.sql`
- `estate-uat-443/migrations-estate-b/20261021000000_estate_payments_one_receipt_per_invoice.pending.sql`
- `estate-uat-443/migrations-estate-b/20261021000001_estate_election_secret_ballot.pending.sql`
- `estate-uat-443/migrations-estate-c/facility_booking_overlap_exclusion.pending.sql`
- `estate-uat-443/migrations-estate-d/estate_notifications_archive.pending.sql`
- `estate-uat-443/migrations-estate-d/estates_lifecycle_status.pending.sql`

Per-module narrative and evidence: `cluster-<lane>.md`; ledgers: `rtm-/defects-/exec-<lane>.csv` in this directory.

Close-out plan and per-case work disposition: `CLOSEOUT-PLAN.md` (phases and exit criteria) with
`closeout-triage.csv` (300 non-`PASSED` rows tagged `E`/`B`/`M`/`P` and assigned a wave; generated
from the ledgers, claims no evidence and changes no result).
