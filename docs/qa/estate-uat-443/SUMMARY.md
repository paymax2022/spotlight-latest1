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

### Current counts (2026-10-27, after Phase 2.4)

| Lane | Rows | Passed | Failed | Blocked | Not run | Needs manual | Other |
|---|---|---|---|---|---|---|---|
| estate-a | 115 | 60 | 0 | 47 | 0 | 4 | 4 |
| estate-b | 116 | 57 | 5 | 6 | 48 | 0 | 0 |
| estate-c | 116 | 18 | 55 | 41 | 0 | 2 | 0 |
| estate-d | 96 | 51 | 0 | 25 | 0 | 19 | 1 |
| **Total** | **443** | **186** | **60** | **119** | **48** | **25** | **5** |

estate-a's `Other` column is the four `PARTIAL` **results** Phase 2.4 introduced (0037, 0047, 0049,
0050): the check that ran passed, but a named leg of the case was never executed. `PARTIAL` was already
a value in the `implementation` column; using it as a result is deliberate and defined in
`cluster-estate-a.md`. estate-d's single `PARTIAL` result (`EST-UAT-0423`, M22 user disable) predates this phase.

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

### Phase 2.1 (2026-10-27): the secret-ballot schema split

Wave 2 opens with the two rows Phase 1 could not settle, because no existing check could:
`0213` (cast a valid secret ballot) and `0216` (receipt anonymity) failed on a schema that
stored `election_votes(election_id, voter_id, candidate_id)` — one row permanently linking a
voter to a choice, so no amount of API sealing could make them pass. Built and executed:

| Piece | Change | Evidence |
|---|---|---|
| Schema | `supabase/migrations/20271099000010_estate_election_secret_ballot.sql` (additive): anonymous `election_ballots` (id, election_id, **nullable** candidate_id = abstention) and **no timestamp column** — a copied `cast_at` would have been the join key that rebuilds the link the split exists to break. `election_votes.candidate_id` becomes nullable; the backfill clears it only under a per-election count-parity gate, so no ballot is lost by a partial copy. | `E18`, applied to the local database twice (idempotent re-apply verified) |
| One writer | `estate_cast_vote(election_id, voter_id, candidate_id)` SECURITY DEFINER function: inserts participation, returns `23505` on a second vote and `23503` on a foreign candidate, then writes the ballot in the same transaction. Go `CastVote` and the BFF vote route both call it, so neither path can write a linked row. | `E17`, `E19` |
| Read paths | `GetResults`, admin `ElectionResults`, admin `ElectionAudit` (`ballots_cast` vs `distinct_voters`, deliberately mismatched sources) and BFF `mapElection` now count `election_ballots`; abstentions count in turnout but credit no candidate. | `E17`, `E19` |
| New check | `TestLiveDB_Vote_BallotCannotBeJoinedToVoter`: `information_schema` scan proves the ballot table exposes no `%voter%/%user%/%member%/%identity%/%cast%/%time%/%_at%` column, the participation table holds `candidate_id IS NULL` everywhere, and the naive `election_votes JOIN election_ballots ON election_id AND candidate_id` rejoin returns 0 rows. | `E17` |

Live-DB suite re-ran **61 top-level PASS / 30 subtests PASS / 0 FAIL / 0 SKIP in 83.969s**
(`live-2026-10-26/livedb-estate-suite-phase2.1.log`); vitest 118 PASS; `tsc --noEmit`,
`go build`, `go vet` and the Go unit suites clean.

Ledger effects: `0213`/`0216` → `PASSED`, `0221` → `PARTIAL` implementation with
`NOT_RUN` result (schema half done, abstain API/UI is Phase 2.2); ESTB-D003 and ESTB-D011
→ `FIXED`; **ESTB-D013 found by this work** — `GetResults` scanned a NULL candidate bio into
`*string` and returned a 500, which no prior test had ever reached; now `COALESCE`d and
asserted by `E17`.

### Phase 2.2 (2026-10-27): the election governance workflow (estate-b M11)

Phase 2.1 closed ballot secrecy; the 15 remaining M11 rows described the workflow that is
supposed to surround a ballot, and none of it existed. An estate could gate *who* may vote
and then nothing else: elections went straight to `open`, "candidates" were whatever the
create call listed, there was no roll to publish or challenge, no quorum, no tie-break, no
complaint, no recount, no cancellation and no non-binding poll. These could not be
harvested from prior evidence — the checks had to be built, so this slice is a build, not a
re-marking pass.

| Piece | Change | Evidence |
|---|---|---|
| Schema | `supabase/migrations/20271099000020_estate_election_governance.sql` (additive): 7 tables (`election_rule_proposals`, `election_rolls`, `election_roll_entries`, `election_roll_challenges`, `election_nominations`, `election_complaints`, `election_recounts`), 12 `elections` columns (kind/weighting/quorum/tie-break, nomination window, roll freeze, rules lock, cancellation triple), a strictly wider status CHECK adding `cancelled`, and `election_votes.unit_id` guarded by two partial uniques instead of the old unconditional one. RLS enabled on every new table, service-role policy only. | `E20`, applied earlier in the slice and re-run verbatim here to prove idempotent re-apply |
| One writer, upgraded | `estate_cast_vote(election, voter, candidate, unit)` enforces in the writing statement: not cancelled, open and in window, candidate belongs to the election (NULL = abstention), the voter is on the **latest frozen roll** when one exists, and a unit ballot requires the caller to hold that unit. The 3-arg form delegates, so Phase 2.1's single write path is preserved. | `E20`, `E21`, `E23` |
| Service + HTTP | `backend/internal/estate/election_governance.go` (+ handler) with 29 estate-scoped routes: config → rules proposal/decision → roll build/freeze/list/remove/exception → challenge/resolve → nominate/decide/vet/certify → open → close → cancel → tally/certify → outcome/turnout → complaint/recount/recounts → my-eligibility. Every handler binds `(estate, election)` from the path and never trusts an election id alone. | `E21`, `E22` |
| Consoles | `frontend-admin/app/admin/estate/elections/_governance.tsx` drives the workflow and surfaces the service's own refusal text; mobile casts abstentions and per-unit ballots, and the BFF reads participation as a **list** (a `maybeSingle()` there broke the receipt screen for every weighted voter). | `E22` |

Verified: **13 top-level PASS / 3 tie-break subtests PASS / 0 FAIL / 0 SKIP in 26.694s** on the
new lane (`E21`, `live-2026-10-26/livedb-governance-phase2.2.log`), the full estate live-DB
suite re-run green afterwards (`E23`), and `E22` = frontend-web 13 files / 146 estate tests
(including the new 21-test `election-governance-bff.spec.ts`), frontend-admin console transport
8 tests, mobile voting 49 tests, `tsc --noEmit` clean in both web projects, `go build ./...`,
`go vet` and the estate + association packages clean.

Ledger effects: `0202`, `0203`, `0204`, `0205`, `0208`, `0209`, `0210`, `0211`, `0219`, `0221`,
`0223`, `0225`, `0227`, `0229`, `0230` → `IMPLEMENTED` / `PASSED`; `0226` and `0228` keep their
`PASSED` results with the publish path now delegating certification and the audit surfaces
completed; `0222` stays `NOT_RUN` **by decision** — ranked-choice and multi-seat tabulation both
need the counter to know a voter's ordered or repeated selections, which is precisely the
voter→choice link `0216` forbids, so it needs a sealed-tabulation design rather than a column.
`ESTB-D014` (the umbrella governance defect) → `FIXED`; **`ESTB-D015` found by this work and
recorded, not fixed** — the BFF `POST /api/v1/elections` still writes `status='open'`, so an
app-created election cannot enter the workflow at all; that is a product decision about the
mobile authoring surface, and re-marking `0202` past it would have hidden it.

### Phase 2.3 (2026-10-27): estate profile, invitations and ownership governance (estate-a M02)

Phase 2.1 and 2.2 built election machinery; this slice goes back to the estate object itself.
M02 held 13 planned rows (14 in practice — `0036` branding was counted separately in the triage)
and every one of them was `BLOCKED` on the same statement: `estates` had no lifecycle beyond the
`status` column `caef65516` added, no timezone, no branding, no notice, no duplicate detection, no
configuration revision history, no role-scoped invitation and no way to hand an estate to another
owner. Like wave 2's earlier slices this is a **build**: the HTTP lane that finally settled them
(`EXEC-ESTA-026`) could not have run a week ago because there was nothing to probe.

| Piece | Change | Evidence |
|---|---|---|
| Schema | `20271099000040_estate_profile_governance.sql` (additive): `estates.timezone` validated against `pg_timezone_names` by the `estates_require_known_timezone_on_write` trigger + constraint, `estates.branding` (allow-list `logo_url`/`primary_color`/`accent_color`/`banner_url`, `#rrggbb`, http(s), ≤4096 B), `estates.notice` ≤2000 **runes**, `estates.duplicate_suspected` with a normalised (name,address) lookup, `estate_config_revisions` written by the AFTER trigger `estate_config_record_revision_on_write` under `pg_advisory_xact_lock`, and `estate_owner_transfers` with one-pending-per-target partial unique + the single `SECURITY DEFINER` writer `estate_owner_transfer_decide` (SQLSTATE 42501 / 55000 / P0002). Plus `20271099000050_estate_invite_roles.sql`: `estate_invite_codes.role` defaulting to `resident`, CHECK bounded by `estate_residents_role_check`, `(estate_id,role)` index. | `EXEC-ESTA-024` — both applied and **re-applied verbatim**, exit 0 with only `already exists, skipping` notices, then verified from the catalog and re-tested |
| Service | `backend/internal/estate/profile.go` (profile read/update, duplicate lookup, config history, transfer request/list/decide) + `profile_handler.go`, wired by `backend/internal/app/estate_profile_routes.go` `RegisterEstateProfile`; `CreateEstate` now requires a ≥2-rune trimmed name and routes a normalised twin to the review queue instead of silently creating a duplicate. | `EXEC-ESTA-025` |
| Lifecycle posture | Writes to a non-`active` estate are refused with `423` + `"code":"ESTATE_NOT_ACTIVE"` outside an explicit exemption list (SOS, guard incident/checkout/sync, code revoke/blacklist, offline log sync, legacy import); verify/reject/suspend/reactivate/close are RBAC-bound by `estate.admin.lifecycle` and every transition records a ≥5-rune reason. | `EXEC-ESTA-026` sections C–D |
| Consoles/handlers | Manager invite codes mint with an explicit role and a resident code can no longer demote an existing `estate_admin`; ownership moves **only** when the target accepts — decline, withdraw and a mis-pathed decision all leave `admin_id` untouched, and the demoted former owner loses the estate's admin privileges. | `EXEC-ESTA-025`, `EXEC-ESTA-026` sections F/H |

Verified over HTTP on a scratch-built backend at `:8095` (the `:8091`/`:8093`/`:8094` instances from
other sessions were left running): **140 PASS / 0 FAIL in 10 sections** (`EXEC-ESTA-026`,
`live-2026-10-27/probe-profile.out`); the new live-DB lane **10 PASS / 0 FAIL / 0 SKIP in 17.277s**
(`EXEC-ESTA-025`); whole estate package afterwards **173 top-level + 50 subtests PASS / 0 FAIL / 0
SKIP** (`EXEC-ESTA-028`). Environment build-up, the reviewer grant and the teardown state — `estates`
= 9 closed / 1 active, and the active row is the pre-existing 2026-10-26 seed, not a probe estate —
are recorded in `EXEC-ESTA-027` and `live-2026-10-27/README.md`.

Ledger effects: `0021`, `0022`, `0023`, `0024`, `0025`, `0026`, `0027`, `0028`, `0029`, `0030`,
`0031`, `0032`, `0035`, `0036` → `IMPLEMENTED` / `PASSED`; `ESTA-D010` (the estate-lifecycle schema
defect) → `FIXED`; `ESTA-D011` stays `PARTIAL_FIXED` — `0028`'s manager invite closed one gap, five
grantable roles are still consulted by no action path. **`ESTA-D028` and `ESTA-D029` were found by
this lane's first run** (136/4): a whitespace-only estate name reached `201` and queued live, and
over-length notice plus several caller mistakes returned `500` where `400` is the correct answer;
both fixed in the same slice. One of the four original failures was a wrong premise in the probe
(`Europe/Nairobi` is not an IANA zone — the server's `400` was right) and is documented rather than
hidden.

Limits written into the rows rather than glossed: `0031` is **policy storage, not timezone-aware
scheduling** — no estate code reads `timezone` for computation yet; `0036`'s branding payload has **no
client consumer** (grep over `frontend-web/app`, `frontend-web/src` and the mobile app found none);
`0035` covers estate-level ownership only, not per-unit transfer; `0030` claims server-side scoping,
not the mobile estate-switcher UX. `0033`/`0034` (bulk estate/building upload) stay `MISSING` /
`BLOCKED` under `ESTA-D016`, which is a separate importer slice.

### Phase 2.4 (2026-10-27): unit occupancy, capacity, terms and proof (estate-a M03)

M02 gave the estate a lifecycle; M03 had to give its **units** a state. All 16 M03 rows were
`BLOCKED` at the start of this phase and every one of them was blocked on the same missing fact: nothing
in the schema recorded *who occupies which unit*. `estate_residents` is one row per (estate, user) with a
free-text `unit` label and no foreign key, so occupancy was not countable; `estate_properties` had no
capacity; a tenancy approval threw away the lease dates it had just been given; owner and tenant were two
UUID columns with no rule between them; and dues billed whatever amount the caller typed. Like Phase 2.3
this is a **build**, not a re-run — the HTTP lane could not have existed a week ago.

| Piece | Change | Evidence |
|---|---|---|
| Schema | `20271099000060_estate_occupancy_integrity.sql` (568 lines, additive only): `estate_unit_occupants` (one row per unit+person, `effective_from`/`effective_until`, `ended_at`, `in_effect`), `estate_properties.capacity` defaulting to 6 under `CHECK (capacity > 0)`, two partial uniques (one live owner, one live tenant per unit), the `SECURITY DEFINER` writers `estate_occupancy_admit` / `estate_occupancy_release`, the capacity trigger, `estate_enforce_vacant_unit_exemption` and `estate_enforce_out_of_term_billing` on invoice INSERT (each waivable only by its own override column **plus** a written reason), and `resident_profiles.proof_status`/`proof_verified_by`/`proof_verified_at`/`proof_review_note` with `estate_reset_proof_on_redeclaration`. | `EXEC-ESTA-032` — applied, then **re-applied verbatim** after the final green run (exit 0, 19 notices, all `already exists, skipping`), and read back from the catalog in `05-schema-occupancy.sql` (RLS on, both writers `prosecdef=t`, four triggers, both partial uniques intact) |
| Service | `backend/internal/estate/occupancy.go` (656 lines) + `occupancy_handler.go`: `AdmitOccupant`, `ReleaseOccupant`, `ListOccupancies`, `SetUnitCapacity`, ownership-claim queue, `GetOccupancyProof`/`VerifyOccupancyProof`, and the term-aware membership check. `AssignLandlord`/`AssignTenant` no longer UPDATE a UUID column — they delegate to the same admitting writer a tenancy approval uses, so capacity, overlap, the archived-unit rule and "membership must still be active" are checked once, in the database. | `EXEC-ESTA-030`, `EXEC-ESTA-029` sections 3–5 |
| Product decisions (2026-10-27) | EST-UAT-0044 → capacity as a per-unit count (default 6) with one current owner and one current tenant, and one owner holding many tenant units allowed; dependants in `household_members` do not consume a bed. EST-UAT-0048 → **vacant units are exempt**, overrideable only in writing. EST-UAT-0045 → the term gates access **and** dues, `NULL` window = unrestricted; the voting leg was descoped and is named in the row rather than claimed. | `cluster-estate-a.md`, rows 0044/0045/0048 |
| Error surface | `writeOccupancyError` replaced the blanket `403`: caller mistakes are `400` naming the field, foreign or retired resources `404`, rule refusals `409`, privilege refusals `403` (`ESTA-D032`, `D035`..`D038`). | `EXEC-ESTA-029` sections 2b, 5b, 10, 12 |

Verified over HTTP on a scratch-built backend at `:8095` (the `:8091`/`:8093`/`:8094` instances belonging
to other sessions were never disturbed): **264 PASS / 0 FAIL across the 25 labelled sections** of
`live-2026-10-27/probe-occupancy.out` (`EXEC-ESTA-029`); the new occupancy live-DB lane **8 PASS / 0 FAIL /
0 SKIP in 10.857s** (`EXEC-ESTA-030`); whole estate package afterwards **181 top-level + 50 subtests PASS /
0 FAIL / 0 SKIP** with `go build ./...` and `go vet` both exit 0 (`EXEC-ESTA-031`). The lane's step-up
grants, reviewer grant, final database state and teardown are recorded in `EXEC-ESTA-032`.

Ledger effects: `0038`, `0039`, `0040`, `0041`, `0043`, `0044`, `0045`, `0046`, `0048`, `0051`, `0052` →
`IMPLEMENTED` / `PASSED`; `0037`, `0047`, `0049`, `0050` → **`PARTIAL` as a result** — the check that ran
passed and a named leg never executed (no building API exists at all; no property transfer ever completed
successfully; plate registry is per-resident with no gate consumer; refusals are proved but not logged);
`0042` stays `BLOCKED` (it is not this slice). `ESTA-D015` — the occupancy rules engine M03 had been
blocked on since wave 1 — → `FIXED`; `ESTA-D030`..`D032`, `D034`..`D038` → `FIXED`; `ESTA-D033`, `D039`,
`D040` → `RECORDED` for the product owner rather than quietly widened.

Limits written into the rows rather than glossed: the register read is **outside** the term gate by design
(a member reads their own rows, which is why `ESTA-D033` is a recorded gap and not a fix); nothing
auto-releases a registration at `lease_end`; the vehicle registry is never consulted by the gate;
`estate_unit_occupants` is read only by the occupancy module, so EST-UAT-0045's voting leg is unproved;
and the occupancy surface itself is **Go-only** — no mobile screen and no BFF route calls admit, release,
register, capacity, claim or proof. One pre-existing BFF read does touch this data
(`frontend-web/app/api/v1/estate/properties/route.ts`, tracked since before this slice): it selects the
unit's `occupancy_status`, `landlord_id` and `tenant_id` straight from `estate_properties` with the admin
client, so it reflects the deed columns the admitting writer maintains — but it never reads
`estate_unit_occupants`, so it cannot show capacity, a term window or occupancy history. What is proved
here is the backend, not a user-visible flow.

### Defect status changes

Counted from `defects-<lane>.csv` on 2026-10-27, after Phase 2.4 (the roll-up table at the top is
the 2026-10-21 consolidation snapshot and has not been rewritten):

| Lane | Defects | FIXED | PARTIAL_FIXED | RECORDED | S1/S2/S3/S4 | shared-platform |
|---|---|---|---|---|---|---|
| estate-a | 40 | 23 | 3 | 14 | 5/20/15/0 | 3 |
| estate-b | 15 | 10 | 0 | 5 | 3/5/7/0 | 1 |
| estate-c | 18 | 9 | 0 | 9 | 0/12/4/2 | 0 |
| estate-d | 35 | 10 | 3 | 22 | 5/17/13/0 | 5 |
| **Total** | **108** | **52** | **6** | **50** | **13/54/39/2** | **9** |

`ESTA-D011`, `ESTA-D021`, `ESTA-D022` → `PARTIAL_FIXED` (commit `554173ae0`);
`ESTA-D010` → `FIXED` in Phase 2.3 (`caef65516` had taken it to `PARTIAL_FIXED` with the status
machine + review queue; profile columns, revision history, owner transfers, role-scoped invites and
the duplicate queue close the rest — committed as `b301468a5`, which is now the `fix_commit` value in
`defects-estate-a.csv` for `ESTA-D010`, `ESTA-D028` and `ESTA-D029`);
`ESTA-D028` + `ESTA-D029` → found **and** `FIXED` inside Phase 2.3;
`ESTD-D025` → `FIXED` (commit `caef65516`, BFF mirror `fc6fd64f7`);
`ESTD-D016` → `PARTIAL_FIXED` (commit `caef65516`; hold gate built, retention sweep not);
`ESTD-D034` → `PARTIAL_FIXED` (commit `caef65516`; importer covers unit/resident/dues-balance only).
`ESTA-D027` → `FIXED` (fixture regression from `fc6fd64f7`; `status: 'active'` seeded in the four
specs and 2 negative 423 specs added, committed as `c4c69e0cd` on 2026-10-27).
`ESTA-D015` → `FIXED` and `ESTA-D030`..`D032`, `D034`..`D038` → `FIXED`, with `ESTA-D033`, `D039` and
`D040` `RECORDED`, all on 2026-10-27 in Phase 2.4. Those nine `FIXED` rows carry an **empty
`fix_commit`** — the slice is not committed yet, so the hash will be written when it lands (the
migration it ships, `20271099000060_estate_occupancy_integrity.sql`, is likewise applied locally but
untracked).
`ESTB-D003` + `ESTB-D011` → `FIXED` and `ESTB-D013` recorded **and** fixed in the same slice
(Phase 2.1, above); `ESTB-D014` → `FIXED` in Phase 2.2 and `ESTB-D015` recorded there without a
fix. Both phases shipped together as `c4c69e0cd` (migration, Go service and handlers, BFF routes,
admin console, mobile ballot/receipt screens and this pack's ledgers), which is now the
`fix_commit` value in `defects-estate-b.csv` for those four rows.

**Evidence durability caveat:** `.gitignore:52` excludes `*.log`, so the transcripts named in
`exec-estate-b.csv` and `live-2026-10-26/README.md` (`livedb-estate-suite.log`,
`livedb-estate-suite-phase2.1.log`, `livedb-governance-phase2.2.log`,
`livedb-estate-suite-phase2.2.log`) exist only in this working tree — the commit carries the
tests that produce them, not their captured output. Re-running `E21`/`E23` regenerates them.
Phase 2.3 avoided the problem by writing its transcripts as tracked `.out` files
(`live-2026-10-27/probe-profile.out`, `livedb-estate-profile-phase2.3.out`,
`livedb-full-suite-phase2.3.out`), so that lane's captured output travels with the commit.

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
   `FEATURE_ESTATE_LIFECYCLE_ENABLED` and `FEATURE_ESTATE_VERIFICATION_REQUIRED` were exercised over
   HTTP in Phase 2.3 (EXEC-ESTA-026, 140 assertions on `:8095`) and again in Phase 2.4 (EXEC-ESTA-029,
   264 assertions, which also needed them on to publish and close its probe estates) — and behave as
   specified — but the
   **flag-off** lane is still owed (Phase 2 exit criterion), so the shipped default has not yet been
   compared against the verified posture. `FEATURE_ESTATE_IMPORT_ENABLED` remains unexercised over
   HTTP.
2. Wire host-arrival approval and staff grants into the BFF/mobile surface, or formally record the
   Go routes as the product surface for those cases. The BFF lane narrowed this to two concrete
   edits: authorise `/api/v1/visitor/gate/**` against `estate_staff_grants` (not membership alone),
   and write + read `require_host_approval` in `codes/route.ts`. Phase 2.4 adds a third, same-shaped
   item: the M03 occupancy surface (admit / release / register / capacity / claim / proof) is
   **Go-only**, and the one BFF read that touches this data
   (`app/api/v1/estate/properties/route.ts`) selects the unit's `occupancy_status`/`landlord_id`/
   `tenant_id` columns directly and never reads `estate_unit_occupants` — so capacity, term windows and
   occupancy history are not yet visible to any client.
3. ~~Seed a demo estate and run the BFF visitor golden path over HTTP~~ — done
   (`live-2026-10-26/`, EXEC-ESTA-021/022); 0073, 0092, 0102, 0111, 0112, 0113, 0114, 0115 converted.
4. ~~Promote the 6 `*.pending.sql` drafts below~~ — only **one** genuinely unapplied draft is left; see *Pending schema changes* below.
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
| ESTA-D010 | S2 | estate-a | Estate lifecycle & governance schema absent: no draft/publish/verify/deactivate/transfer/tz/branding | **left this list on 2026-10-27** — `FIXED` by Phase 2.3; `estates.timezone/branding/notice/duplicate_suspected`, `estate_config_revisions` and `estate_owner_transfers` now exist and are live-proven (EXEC-ESTA-024…028). Bulk estate/building import (`ESTA-D016`) is still open | no |
| ESTA-D011 | S2 | estate-a | Estate role model is binary (resident/estate_admin): no finance/gate/election/facility/auditor/temporary delegations | PARTIAL_FIXED (`554173ae0`: `estate_staff_grants` + fail-closed `assertGate` for guard roles only; the other 5 roles are grantable but enforced nowhere; Phase 2.3 added role-scoped invite codes) | no |
| ESTA-D012 | S2 | estate-a | Merchant onboarding lacks withdraw/suspend/reactivate; resubmit only from NEEDS_MORE_INFO | RECORDED | yes |
| ESTA-D017 | S2 | estate-a | QR payload unsigned; no offline cached-credential admission policy | RECORDED | no |
| ESTA-D021 | S2 | estate-a | No per-gate assignment, supervisor-override permission, identity check, or device binding at the gate | PARTIAL_FIXED (`554173ae0`: guard admit authz fail-closed behind `FEATURE_ESTATE_GUARD_GRANTS`; override permission, identity check, device binding and `code.gate` all still absent). Live-confirmed 2026-10-26 (EXEC-ESTA-022) that the **BFF authorises gate work by membership alone** — an ungranted plain resident opened a shift, read the expected list and admitted a visitor | no |
| ESTA-D022 | S2 | estate-a | Resident real-time approval flow absent (approve/decline/timeout) | PARTIAL_FIXED (`554173ae0`: Go has pending/approved/declined + 15-min TTL, live-proven; `timeout` is never written and the BFF/mobile path does not read `require_host_approval`). Live-confirmed (EXEC-ESTA-022): `requireHostApproval:true` is stored as `require_host_approval = f` and the guard admitted it with no host decision | no |
| ESTA-D024 | S2 | estate-a | Estate directory enumerable by any authenticated user while `FEATURE_ESTATE_GUARD_GRANTS` is at its default | RECORDED (found by the EXEC-ESTA-019 control: `{"data":null}` with the flag on vs the full active-estate list with it off) | no |
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

Per runbook rule 5, lanes were to write no migrations. **This section was stale until 2026-10-27**: it
listed 6 drafts, but `git log --diff-filter=A` shows 5 of them had already been promoted —
3 on 2026-10-22 in `dc9c4163d`
(`20271068000010_estate_properties_unique_unit.sql`,
`20271068000020_estate_payments_one_receipt_per_invoice.sql`,
`20271068000030_facility_booking_overlap_exclusion.sql`) and 2 on 2026-10-24 in `caef65516`
(`20271068001000_estates_lifecycle_status.sql`,
`20271068001010_estate_import_batches.sql`), and the `migrations-estate-a/-c` source directories
no longer exist on disk.

**Rule 5 has not held since Phase 2.3, and the later phases did not hide it.** Phase 2.3 wrote and
committed `20271099000040_estate_profile_governance.sql` + `20271099000050_estate_invite_roles.sql`
(in `b301468a5`). Phase 2.4 wrote
`supabase/migrations/20271099000060_estate_occupancy_integrity.sql` — additive, applied to the running
local database and re-applied verbatim to prove idempotency, but **untracked in git** because the slice
is uncommitted. So the outstanding item for that file is promotion to a commit, not promotion to the
schema; the local database already has `estate_unit_occupants`, the capacity CHECK, both partial
uniques, both `SECURITY DEFINER` writers and the four occupancy/dues/proof triggers. Any environment
that has not applied it cannot run the M03 surface.

What is actually outstanding:

- `estate-uat-443/migrations-estate-b/20261021000001_estate_election_secret_ballot.pending.sql`
  — **promoted and applied** 2026-10-27 as
  `supabase/migrations/20271099000010_estate_election_secret_ballot.sql` (`E18`). The draft is
  kept in the lane directory for provenance and is marked SUPERSEDED at the top: the shipped
  version drops its `cast_at` column and makes `candidate_id` nullable, so the draft must not
  be applied.
- `estate-uat-443/migrations-estate-d/estate_notifications_archive.pending.sql` — the only
  genuinely **unapplied** draft left in the pack (Phase 2.5).
- `20271099000060_estate_occupancy_integrity.sql` — applied locally, awaiting its commit (Phase 2.4).

No draft is replayed with `supabase db reset` here: the database holds live-looking learner
and resident data, so promotion is additive-only and applied to the running local database
(`docker exec` + `psql`), which is how `E18` was verified.

Per-module narrative and evidence: `cluster-<lane>.md`; ledgers: `rtm-/defects-/exec-<lane>.csv` in this directory.

Close-out plan and per-case work disposition: `CLOSEOUT-PLAN.md` (phases and exit criteria) with
`closeout-triage.csv` (a work plan, **not** evidence: 282 rows as generated after Phase 2.2, tagged
`E`/`B`/`M`/`P` and assigned a wave; it predates Phases 2.3 and 2.4, claims no evidence and changes no
result — `CLOSEOUT-PLAN.md` carries the staleness note and the regeneration blocker).
