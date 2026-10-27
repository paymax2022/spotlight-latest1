# Estate UAT close-out plan (443 pack) — phases, waves, exit criteria

**Author:** 2026-10-26, after the post-consolidation re-verification in `SUMMARY.md`.
**Scope decision on record:** close out **everything** — Phases 0–8 including Phase 5, with
**no rows waived**. `closeout-triage.csv` therefore contains no `W` disposition.

Companion artifacts: `closeout-triage.csv` (per-case disposition and wave),
`rtm-estate-*.csv` (results, authority for all counts), `defects-estate-*.csv`,
`exec-estate-*.csv`, `live-2026-10-26/` (environment + probe scripts + transcripts).

## Decisions on record (2026-10-26, from the plan owner)

| Gate | Decision | Effect |
|---|---|---|
| Scope | **Close out everything**, including Phase 5; no waivers | no `W` dispositions in the triage |
| Commits | **Commit per phase, do not push** | each wave ends in one commit after its tests and ledgers are updated; exec rows cite that commit |
| `flag-and-migration-policy` (wave 2) | **Flip each flag's default to `true` only after its own flag-on lane passes**; a failing lane leaves the flag off with the failure documented | per-flag evidence, not one consolidated run |
| `phase5-build-depth` (wave 5) | **Full stack**: additive schema + Go service + BFF + mobile app + admin console per cluster | 96 rows, largest slice of the plan |
| `device-and-sandbox-access` (wave 6) | Attempt with what is available (emulators, Playwright, local load tooling); rows whose device or provider sandbox cannot be obtained stay `NEEDS_MANUAL` with the named blocker and the access required | no invented device passes |
| `platform-ownership` (wave 7) | **Handoff briefs + rows marked `BLOCKED: platform`** with ticket references; this pack does not build platform surfaces | 22 rows handed off, not closed |

## Evidence rule (applies to every phase)

Per `docs/qa/UAT-OCT-2026-RUNBOOK.md:75-81`: a row moves to `PASSED` only when a check was
**actually executed**, with the command and its output recorded as an `exec-<lane>.csv` row.
Code inspection yields `BLOCKED`/`NEEDS_MANUAL`, never `PASSED`. No env access, credential or
result is ever assumed or invented. An unbuildable row stays open with its real blocker named —
that is a legitimate end state; a fabricated pass is not.

## Phase 0 — disposition triage (done 2026-10-26)

Every non-`PASSED` row carries exactly one disposition and one wave — 300 when Phase 0 ran, **297 now**
after the Phase 1 harvest converted EST-UAT-0054 and Phase 2.1 converted EST-UAT-0213/0216.

| Disposition | Meaning | Count |
|---|---|---|
| `E` | execute-only — code exists, needs an executed check | 36 |
| `B` | build, then execute | 210 |
| `M` | manual / device / provider-matrix check | 29 |
| `P` | platform-owned handoff | 22 |
| `W` | waived | 0 (full close-out ordered) |

| Wave | Rows | Disposition mix | Decision gate |
|---|---|---|---|
| 1 evidence harvest | 36 | 36 E | none |
| 2 flags + schema promotion | 36 | 36 B | `flag-and-migration-policy` |
| 3 BFF guard authz + host approval | 27 | 27 B | none |
| 4 payment completeness | 48 | 48 B | none |
| 5 feature builds | 96 | 96 B | `phase5-build-depth` |
| 6 device / provider matrix | 31 | 29 M + 2 B | `device-and-sandbox-access` |
| 7 platform handoff | 23 | 22 P + 1 B | `platform-ownership` |

These are the counts in the regenerated `closeout-triage.csv` (297 rows) after Phase 1 and
Phase 2.1. The first pass over the same file, before any evidence was matched, read
E 59 / B 194 / M 30 / P 17 and waves 59/35/27/37/92/32/18; the difference is the 3 conversions,
the 1 correction, the 9 hardened `FAILED` rows and the `ABSENT`-note reclassification described
below.

Rules are recorded per row in the `rule` column (`OVR` = set from a documented decision in
`SUMMARY.md`; `R1`–`R8` = ledger-derived). The triage file asserts no evidence and changes no
RTM result.

## Phase 1 — harvest evidence that already exists (no gate)

The 2026-10-26 run of 60 `TestLiveDB` tests (`backend/internal/estate/{delegation,dual_control,
import,lifecycle,meetings,notifications,paystackfunded,review_fixes,service_dues,vendor_payout}_live_db_test.go`)
plus the HTTP lanes `EXEC-ESTA-017` (Go, flag on) / `018`–`019` (flag-off control) / `021`–`022`
(BFF, 47 assertions) has never been matched case by case.

- Read each test body and match one row at a time; a suite name is not evidence for a case.
- Where a test proves only part of a case, record the scoped claim and keep the row open.
- Re-check estate-a's `IMPLEMENTED`/BLOCKED rows (13 M01, 12 M03) against the BFF transcripts.
- **Exit:** wave-1 rows all carry `EXEC-ESTA-023+` evidence or an explicit non-conversion reason;
  `SUMMARY.md` counts and the `cluster-*.md` module tables refreshed.

### Phase 1 — status: done 2026-10-27, and the harvest was much smaller than expected

The suite was re-executed (`60` top-level PASS / `30` subtests PASS / 0 FAIL / 0 SKIP in 116.702s;
log `live-2026-10-26/livedb-estate-suite.log`; ledger rows EXEC-ESTA-023, `E16`, `EXEC-C017`), every
test body was read to build an assertion inventory, and each open row was matched against what a test
*actually* asserts rather than its suite name. Full write-up: "Phase 1 harvest" in `SUMMARY.md`.

- **1 row converted** — EST-UAT-0054 `BLOCKED → PASSED`, with the scope written into the row (service
  layer only: `TestLiveDBListEstatesIsolation` + `TestLiveDB_PayDues_RejectsCrossEstateInvoice`).
- **1 row corrected** — EST-UAT-0134 `NOT_RUN → BLOCKED` (an overdue notice path exists; the case's
  due-date reminder keys do not).
- **9 rows hardened** from "code review says absent" to "executed test proves the guard" while staying
  `FAILED`: 0129, 0130, 0147, 0161, 0171, 0213, 0216, 0286 (+ the 0134 correction).
- **36 rows still `E`** and the expectation that a free harvest would clear them is **withdrawn**:
  none of the existing tests, probes or transcripts covers what they assert. They need new executed
  lanes, which is Phase 2 work (flag-on / flag-off HTTP per flag) and Phase 3 work (extended
  `06-probe-bff.sh`), not more matching. Wave 1 is therefore folded into Phases 2–3 rather than run
  again on its own.
- Ledger refreshed and validated: 443 rows, 0 ragged, counts `144 PASSED / 62 FAILED / 148 BLOCKED /
  63 NOT_RUN / 25 NEEDS_MANUAL / 1 PARTIAL`. `closeout-triage.csv` was regenerated from the corrected
  ledgers (299 rows then; **297 after Phase 2.1**) and the Phase 0 tables above are its current
  contents.

## Phase 2 — flags and schema (36 rows left, gate: `flag-and-migration-policy`)

Eight estate flags in `backend/internal/config/config.go:1081-1088` all default **false**:
`FEATURE_ESTATE_ENABLED`, `_MERCHANT_GATE`, `_GUARD_GRANTS`, `_DUES_PAYSTACK_CHECKOUT_ENABLED`,
`_DUAL_CONTROL_ENABLED`, `_LIFECYCLE_ENABLED`, `_VERIFICATION_REQUIRED`, `_IMPORT_ENABLED`.
Consequence: `ESTD-D025`/`D027`/`D034` read as FIXED/PARTIAL_FIXED but are unreachable at the
shipped default, and `ESTA-D024` (directory enumerable while `_GUARD_GRANTS` is off) is the
current shipped behaviour.

1. ~~Review and promote the 6 `*.pending.sql` drafts~~ — **corrected 2026-10-27**: only 1 draft was
   ever left unapplied. 5 had already been promoted (`dc9c4163d`, 2026-10-22: unique-unit,
   one-receipt-per-invoice, booking-overlap exclusion; `caef65516`, 2026-10-24: estates-lifecycle
   status, import batches), and the secret-ballot draft was promoted and applied in Phase 2.1 below.
   `estate_notifications_archive.pending.sql` is the only outstanding draft (sub-slice 2.5).
2. Execute a flag-on **and** flag-off HTTP lane per flag, reusing the `live-2026-10-26/` harness
   pattern (script + transcript), then record the ship decision per flag. **Not yet started** — all
   8 flags still default to `false`.
3. Close the two single-actor paths that keep `ESTD-D027` partial (vendor verify, restriction),
   and make caller-scoped estate discovery its own always-on rule (`ESTA-D024`).
- **Exit:** one documented default per flag with executed evidence at that default; migration
  rows applied and re-verified; defect statuses updated or the flag recorded as not-shipped.

### Phase 2.1 — status: done 2026-10-27 (secret-ballot schema split, ESTB-D003/D011) — committed `c4c69e0cd`

Wave 2 is 36 schema/governance builds and flag lanes, not a harvest, so the two P0 secret-ballot
rows had to be *built* rather than re-matched. Delivered end to end:

- `supabase/migrations/20271099000010_estate_election_secret_ballot.sql` — additive anonymous
  `election_ballots` (no voter column, **no timestamp column**, nullable `candidate_id` = abstention)
  plus a count-parity-gated backfill that clears `election_votes.candidate_id`; applied to the running
  local database twice to prove idempotent re-apply (`E18`). Never `supabase db reset` — the database
  holds learner and resident data.
- One atomic writer `estate_cast_vote()` shared by Go `CastVote` and the BFF vote route, so neither
  path can persist a voter→choice row; `23505` → already voted, `23503` → invalid candidate.
- All four read paths re-pointed to ballots (`GetResults`, admin `ElectionResults`, admin
  `ElectionAudit`, BFF `mapElection`), with abstentions counted in turnout but crediting no candidate.
- New live-DB test `TestLiveDB_Vote_BallotCannotBeJoinedToVoter` asserts the join is impossible
  (column scan + rejoin returns 0) instead of merely unused. Suite re-run: 61 top-level PASS /
  30 subtests / 0 FAIL / 0 SKIP in 83.969s (`live-2026-10-26/livedb-estate-suite-phase2.1.log`).
- Found and fixed a real defect on the way: `ESTB-D013` — `GetResults` 500s on a candidate with a
  NULL bio.

Rows: `0213`, `0216` → `PASSED`; `0221` → implementation `PARTIAL` (abstain API/UI still 2.2),
which 2.2 below closes.
Remaining wave-2 sub-slices: ~~**2.2** estate-b M11 governance (15 rows)~~ **done 2026-10-27**,
~~**2.3** estate-a M02 lifecycle (planned 13, actually **14** rows)~~ **done 2026-10-27**,
**2.4** estate-a M03 occupancy (4), **2.5** lane-d
config/import (4) + the last pending draft. The flag-on/flag-off HTTP lanes (item 2) close the phase.

### Phase 2.2 — status: done 2026-10-27 (election governance workflow, estate-b M11, 15 rows) — committed `c4c69e0cd`

Phase 2.1 made the ballot secret; these 15 rows were about everything that has to happen around a
ballot, and none of it existed — elections went straight to `open`, candidates were whatever the
create call listed, and there was no roll, challenge, nomination, vetting, quorum, tie-break,
complaint, recount, cancellation or poll type. Like 2.1 this is a **build**, not a harvest: no
executed check could settle these rows because nothing implemented them.

- `supabase/migrations/20271099000020_estate_election_governance.sql` — additive: 7 governance
  tables, 12 `elections` columns, a strictly wider status CHECK (`cancelled`), `election_votes.unit_id`
  behind two partial uniques replacing the unconditional one, RLS on every new table with a
  service-role-only policy. Applied to the local database and **re-applied verbatim** to prove
  idempotency (`E20`). Never `supabase db reset`.
- `estate_cast_vote(election, voter, candidate, unit)` — the single writer from 2.1, upgraded to
  enforce cancellation, window, candidate ownership, abstention, frozen-roll membership and
  unit-holding in the statement that writes; the 3-arg form delegates so no caller escapes it.
- `backend/internal/estate/election_governance.go` + handler, 29 estate-scoped routes, every one
  bound by `(estate, election)` from the path rather than trusting an election id.
- `frontend-admin/app/admin/estate/elections/_governance.tsx` (workflow console that surfaces the
  service's refusal verbatim) and the mobile/BFF half of abstention + per-unit ballots; the BFF
  receipt read had to stop using `maybeSingle()` because a weighted voter legitimately has several
  participation rows.
- Deliberately **not** built: ranked-choice / multi-seat (`0222`). Both need the counter to know a
  voter's ordered or repeated selections — the persisted voter→choice link `0216` (PASSED) exists
  to forbid. Recorded as a design decision in the migration header, not silently deferred.
- Verification: `E21` 13 top-level PASS / 3 subtests / 0 FAIL / 0 SKIP in 26.694s
  (`live-2026-10-26/livedb-governance-phase2.2.log`); `E23` re-ran the whole estate live-DB suite to
  prove the 2.1 secrecy and one-vote tests still pass after `election_votes` lost its unconditional
  unique; `E22` = frontend-web 146 estate tests + 21-test governance BFF spec, admin console
  transport 8 tests, mobile voting 49 tests, `tsc --noEmit` clean in both web projects, `go build`
  / `go vet` / estate + association packages clean.
- Found on the way, **recorded rather than re-marked past**: `ESTB-D015` — BFF
  `POST /api/v1/elections` writes `status='open'`, so an app-created election can never enter the
  workflow, because every governance verb refuses a non-draft by design.

Rows: `0202`/`0203`/`0204`/`0205`/`0208`/`0209`/`0210`/`0211`/`0219`/`0221`/`0223`/`0225`/`0227`/
`0229`/`0230` → `IMPLEMENTED` / `PASSED`; `ESTB-D014` → `FIXED`; `0222` stays `NOT_RUN` by decision;
`0228` stays `PARTIAL` (aggregates complete, export still absent — Phase 5 reporting cluster).
Estate-b is now 57 PASSED / 5 FAILED / 6 BLOCKED / 48 NOT_RUN.

### Phase 2.3 — status: done 2026-10-27 (estate profile, invitations and ownership governance, estate-a M02, 14 rows) — committed `b301468a5`

The plan budgeted 13 rows; the RTM held 14 in scope (0021–0032, 0035, 0036), because 0030 was
already `IMPLEMENTED` and only lacked an executed check rather than a build. Like 2.2 this is a
**build plus a live lane**: `ESTA-D010` listed timezone, branding, revision history, duplicate
review and ownership transfer as absent, so no executed check could have settled those rows.

- `supabase/migrations/20271099000040_estate_profile_governance.sql` — additive: `estates.timezone`
  (DB-checked against `pg_timezone_names` by trigger and constraint), `estates.branding`,
  `estates.notice`, `estates.duplicate_suspected`, `estate_config_revisions` written by an AFTER
  trigger under `pg_advisory_xact_lock`, `estate_owner_transfers` with a one-pending partial unique,
  and the single `SECURITY DEFINER` writer `estate_owner_transfer_decide`.
  `20271099000050_estate_invite_roles.sql` — additive: `estate_invite_codes.role`, CHECK-bounded to
  the two roles `estate_residents` accepts, defaulting to `resident` so existing codes behave
  unchanged. Both **re-applied verbatim** to prove idempotency (`EXEC-ESTA-024`). Never `supabase db reset`.
- `backend/internal/estate/profile.go` + `profile_handler.go` + `internal/app/estate_profile_routes.go`
  — six governance routes, every one scoped by `(estate, actor)` from the path; ownership moves only
  on the incoming owner's accept, and the demoted former owner keeps membership but loses admin scope.
- Live lanes: `live-2026-10-27/` — HTTP probe **140 PASS / 0 FAIL** (`EXEC-ESTA-026`), profile/invite/
  transfer live-DB suite **10 PASS / 0 FAIL** (`EXEC-ESTA-025`), whole estate package
  **173 + 50 subtests PASS / 0 FAIL / 0 SKIP** (`EXEC-ESTA-028`). The platform-queue cases needed a
  reviewer, and no local user held any `estate.%` permission, so the lane applied a documented,
  reversible `estate.admin.lifecycle` grant (`EXEC-ESTA-027`) instead of skipping them.
- **Two real defects found by the HTTP lane, fixed in the slice**: `ESTA-D028` — `POST /estate`
  accepted a name of spaces (gin's `required,min=2` counts characters) and queued a live estate; and
  `ESTA-D029` — a class of caller mistakes (over-length notice, unknown `?column=`/`?status=`,
  unparseable or self `to_user_id`, unknown timezone on create) answered 500 instead of 400. The
  first probe run was 136 PASS / 4 FAIL; the clean re-run is what is committed, and the whitespace
  estate the first run created was closed over the real `reject` transition, not deleted.
- One probe failure was the probe's own mistake, recorded so it is not read as a product finding:
  `Europe/Nairobi` is not an IANA zone (the real zone is `Africa/Nairobi`) — the server's 400 was correct.

Rows: `0021`–`0032`, `0035`, `0036` → `IMPLEMENTED` / `PASSED`; `EST-UAT-0033`/`0034` (bulk estate/building
import) stay `BLOCKED` as `ESTA-D016`, which is Phase 2.5; `ESTA-D010` → `FIXED`; `ESTA-D011` stays
`PARTIAL_FIXED` — invite role-scoping closed 0028, but the five unconsulted staff roles and the
binary super-role enum remain. Estate-a is now 49 PASSED / 62 BLOCKED / 4 NEEDS_MANUAL.

## Phase 3 — BFF guard authz and host approval (27 rows, no gate)

Highest rows-per-line in the pack. `frontend-web/app/api/v1/visitor/gate/**` authorises by estate
membership alone (`ESTA-D021`, proved live by `EXEC-ESTA-022`: an ungranted resident opened a
shift, read the expected list and admitted a visitor), and `codes/route.ts` never persists
`require_host_approval` (`ESTA-D022`: stored `f`, admitted with no host decision).

1. Authorise the guard surface against `estate_staff_grants`, fail-closed, mirroring `assertGate`,
   under `FEATURE_ESTATE_GUARD_GRANTS` so the flag-off control stays reproducible.
2. Write and read `require_host_approval`; enforce it in the gate flow; add the arrival
   `timeout` writer.
3. Wire the five grantable-but-unenforced roles (`finance_officer`, `election_officer`,
   `facility_officer`, `meeting_secretary`, `auditor`) into their action paths (`ESTA-D011`).
4. Fix the two live-found defects while in here: `gate/lookup`'s `uuid ~~*` filter (`ESTA-D025`)
   and the silent row drop in `codes/import` (`ESTA-D026`); add the offline admission policy and
   client queue (`ESTA-D017`) and the server-side visitor-log filter (row 0096).
- **Exit:** the probes that failed as expected-fail in `06-probe-bff.sh` now refuse; extended
  negative probes recorded as `EXEC-ESTA-02x`; rows 0055/0057/0058/0060/0086–0090/0096/0104–0106/0110 move.

## Phase 4 — payment completeness (48 rows, no gate)

`ESTB-D012` (partial dues, partial rent, overpayment, partial allocation), `ESTB-D009` (rent
payment transfer), plus the adjacent M07–M09 rows the lane never executed. Go `service_dues.go`
and the BFF money paths, kobo-integer arithmetic, one-receipt-per-invoice constraint from the
wave-2 migration. Unit + live-DB tests for rows 0129, 0130, 0147, 0161, 0171.

## Phase 5 — feature builds (96 rows, gate: `phase5-build-depth`)

Eight clusters, ordered by dependency and rows unblocked:

| Cluster | Defect | Rows |
|---|---|---|
| Facility fee confirmation + refund policy | ESTC-D010/D011 | 2 |
| Document governance (version/approve/expire/ack/e-sign/soft-delete/export) | ESTC-D013 | 9 |
| Announcement governance (targeting/draft/schedule/pin/attach/history/moderation) | ESTC-D014 | 10 |
| Procurement (RFQ/bids/contracts/authority matrix/three-way match/credentials/ratings/renewals) | ESTC-D012 | 10 |
| Asset & maintenance planning (registry/warranty/SLA/schedules/blackout/meters/projects) | ESTC-D016 | 9 |
| Incident workflow (ack/escalation/geo-target/failover/false-report/updates/reopen) | ESTC-D015 | 9 |
| Report exports (CSV/XLSX/PDF, async jobs, scheduled email, PII minimisation, rent roll) | ESTC-D017/D018 + ESTD-D018 | 5+ |
| Anonymous issue submission | ESTC-D018 | 1 |
| Estate-side privacy/security builds | ESTD-D009/D015 + DSAR, virus scan, search index, cross-estate config, provider queue, suspicious-access alerting | remainder |

The cluster column above is the shape of the work, not a recount: the regenerated triage puts **96
rows** in wave 5, of which 86 are estate-c (by cited defect: procurement `ESTC-D012` 17, incident
`ESTC-D015` 14, documents `ESTC-D013` 12, assets/maintenance `ESTC-D016` 12, announcements
`ESTC-D014` 11, exports `ESTC-D017` 11, facility fees `ESTC-D010/D011` 2, anonymous reporting 1, and
12 rows citing no defect because the behaviour was never built), 7 are estate-b M10 meeting rows and
3 are estate-d (`ESTD-D015/D018/D033`). `closeout-triage.csv` is the authority for which case sits in
which cluster.

Each cluster lands as additive schema + Go service + BFF/mobile surface + executed tests, with
its own exec rows and defect-status change. Build depth is **decided** (2026-10-26): full stack —
schema, Go service, BFF, mobile app and admin console — not backend-only.

## Phase 6 — device / provider matrix (31 rows, gate: `device-and-sandbox-access`)

Never executed in this pack: `go test -race`, `make verify`, the mobile Playwright e2e pass.
Plan: Playwright + emulator runs for 0397/0398/0400–0404/0413/0415/0416; screen-reader and
contrast audit for 0402/0403; keyboard nav 0404; load runs for 0408–0410 against the Go backend
on `:8093`; provider fault injection for 0356/0362–0364/0368/0371/0375. Requires real devices,
an accessibility toolchain and provider sandbox credentials. Where an asset cannot be obtained,
the row keeps `NEEDS_MANUAL` with the named blocker, the requester and the access needed.
Wave 6 as regenerated is 31 rows: 27 estate-d (the device, accessibility, load and provider-fault
cases above), 2 estate-a and 2 estate-c — and 2 of the 31 are `B`, not `M`, because a code path is
genuinely missing before any device could pass them.

## Phase 7 — platform-owned handoffs (23 rows, gate: `platform-ownership`)

`ESTA-D012` merchant onboarding lifecycle, `ESTA-D014` vendor payout verification, `ESTA-D018`
SMS/push delivery to visitors, `ESTB-D010` webhook signature seam, `ESTD-D014` MFA enforcement,
`ESTD-D019` push-token retirement, `ESTD-D020` platform auth/RLS/session, `ESTD-D028` support
impersonation, `ESTD-D031` per-estate flag granularity — plus rows 0165/0178 and the estate-d
CSRF/session-reuse rows. Deliverable per defect: a brief with the UAT case ids, expected vs
actual, this pack's evidence, and the requested owner. Rows then read `BLOCKED: platform` with a
ticket reference; this pack never claims their closure.

## Phase 8 — verification and sign-off

`go test -race ./internal/estate/...`, `make verify`, `npx vitest run tests/unit`,
`npx tsc --noEmit`, eslint on touched trees, all `live-2026-10-26/` probe scripts re-run on a
clean reset, then refresh `SUMMARY.md` counts and both ledgers, and publish the UAT verdict with
a residual-risk register listing every non-`PASSED` row and its disposition.

## Standing constraints (unchanged)

Additive-only migrations; never apply `supabase/migrations/20271025001000_purge_film_academy.sql`;
never `supabase db push`; preserve learner/enrollment/grade/certificate data; never expose answer
keys to learners; in this shared worktree no bare `git stash`/`git stash pop`; do not touch
`supabase/migrations/20271099000003_events_commerce.sql` or `.claude/worktrees/*`; commit only
when asked; handle the service-role key without printing it.
