# Estate UAT — Cluster A (M01–M06) findings

Lane: `estate-a` · worktree `/tmp/uat-estate-a` · branch `uat/estate-a` · 115 cases
(EST-UAT-0001..0115). Source pack: `Estate_Visitor_Access_UAT_Workplan_Test_Cases.md`.

## Result summary

Counted from `rtm-estate-a.csv` on 2026-10-27, after the Phase 1 evidence harvest, the Phase 2.3
estate-governance lane (`live-2026-10-27/`, which moved 14 M02 rows from BLOCKED to PASSED) and the
Phase 2.4 unit-occupancy lane (same directory, 15 M03 rows re-marked — 11 to PASSED and 4 to PARTIAL
with the unproved half named in each row; the RTM is the authority; the prose in the module sections
below was the 2026-10-21 snapshot, which pre-dated the live-DB and API_LIVE runs):

| Module | Cases | PASSED | PARTIAL | BLOCKED | NEEDS_MANUAL | FAILED | NOT_RUN |
|---|---|---|---|---|---|---|---|
| M01 Account, identity & merchant upgrade | 20 | 0 | 0 | 19 | 1 | 0 | 0 |
| M02 Estate creation & governance | 16 | 14 | 0 | 2 | 0 | 0 | 0 |
| M03 Properties, units & occupancy | 16 | 11 | 4 | 1 | 0 | 0 | 0 |
| M04 RBAC, delegation & tenancy isolation | 16 | 7 | 0 | 9 | 0 | 0 | 0 |
| M05 Visitor invitations & access codes | 32 | 19 | 0 | 11 | 2 | 0 | 0 |
| M06 Gate operations & security desk | 15 | 9 | 0 | 5 | 1 | 0 | 0 |
| **Total** | **115** | **60** | **4** | **47** | **4** | **0** | **0** |

`PARTIAL` is a new value in this lane's RTM (estate-d already used it) and it is reserved for a row
where the check that ran passed and a *named* half of the case did not get executed — 0037 has no
building API to exercise, 0047 never runs a successful unit-ownership transfer, 0049 leaves estate-wide
plate policy and parking stalls unbuilt, and 0050 cannot show a refusal in the audit log because
refusals are not logged (`ESTA-D040`). It is not a soft `PASSED`.

`BLOCKED` here means "implementation reviewed in code, but no live backend/DB exists
in this lane to exercise it" — see Environment below. It is not a failing verdict.
That sentence is now only partly true for this lane: `live-2026-10-26/` records both a
Go backend (`:8093`/`:8094`) and the Next.js BFF (`:3000`) driven over HTTP, and
`live-2026-10-27/` adds a third lane (`:8095`) that exercised M02 (Phase 2.3) and then M03
(Phase 2.4) — those two lanes are what put 14 M02 and 11 M03 rows into `PASSED`. The M04/M05/M06
`PASSED` rows came from the 2026-10-26 harness, not from `:8095`. The remaining
47 BLOCKED split 14 `MISSING` (visitor cases with no implementation to exercise,
plus the two bulk-import cases 0033/0034), 18 `PARTIAL` and 15 `IMPLEMENTED` — the
last two groups are code-reviewed only, with no executed check behind the row they
sit on.

## Environment / execution honesty

- `localhost:8080` is an **unrelated OrbStack `rx-api` container**, not this
  backend — every path including `/` returns `{"error":"Unauthorized"}`. At the time
  this was written the Go backend was not running locally and `supabase status`
  reported "Not linked", so no `TEST_DATABASE_URL` was reachable and the
  `*_live_db_test.go` suites skipped. **That limit has since been lifted**: see
  `live-2026-10-26/README.md`.
- Executed: `go build` + `go vet` + `go test ./internal/estate/...` (green),
  `npx vitest run tests/unit/estate` (12 files / 116 tests, EXEC-ESTA-013), the
  60-test `TEST_DATABASE_URL`-gated live-DB suite (EXEC-ESTA-014, re-run clean on
  2026-10-27 as EXEC-ESTA-023 — 60 PASS / 0 FAIL / 0 SKIP, log
  `live-2026-10-26/livedb-estate-suite.log`) and the BFF HTTP
  probes (EXEC-ESTA-021 / EXEC-ESTA-022).
- PASSED is only asserted where a unit spec, a live-DB test or an HTTP probe provides
  evidence.

## Architecture note — two parallel visitor/gate stacks

The same domain is implemented twice:

1. Go: `backend/internal/estate` behind `POST/GET /api/finance/estate/:id/...`
   (`visitor_access_codes`, `visitor_checkins`, `guard_shifts`, `estate_gates`,
   `offline_gate_logs`), feature-flagged `FEATURE_ESTATE_ENABLED`.
2. Next.js BFF: `frontend-web/app/api/v1/visitor/**` over Supabase service-role
   (`visitor_gate_events`, `gate_sessions`, `visitor_blacklist`,
   `visitor_incidents`, `visitor_notifications`), consumed by
   `mobile-app/reactnative` (`app/visitor`, `app/guard`, `src/features/visitor`).

The BFF is what the mobile apps actually call. The Go guard surface is the
better-hardened of the two (member gates added in a prior wave); the BFF had
missed equivalent enforcement, which is where most M05/M06 defects lived.

## M01 — Account, identity & merchant upgrade (platform-heavy)

Merchant upgrade = `backend/internal/onboarding` (platform-owned lane): draft →
submit (schema-validated, idempotent) → review (approve/reject/request-info/
escalate) → `merchant_profiles` + `RoleToGrant` + audit. Covers 0004–0009,
0013(partial). Gaps, all `shared_platform=yes` under ESTA-D012: no withdraw,
suspend, reactivate endpoints; resubmit only from NEEDS_MORE_INFO.
Estate-side: residency membership gate (`assertResident`) covers 0019;
`SoftDeleteAccount` now refuses accounts with open invoices (ESTA-D013, fixed).

## M02 — Estate creation & governance

Closed by Phase 2.3 on 2026-10-27 (`live-2026-10-27/`; `ESTA-D010` → FIXED, two new
defects found and fixed in the process). `POST /api/finance/estate` under
`FEATURE_ESTATE_VERIFICATION_REQUIRED` creates an **application**, not a live estate:
`status='pending'`, creator as owner, platform zone inherited, and every mutating
`/estate/:id/**` call refused `423 ESTATE_NOT_ACTIVE` until a holder of
`estate.admin.lifecycle` verifies it through `/estate-admin/estates`. Duplicate
detection normalises (name, address) so a differently-typed twin lands in the queue
flagged `duplicate_suspected` instead of becoming a second live estate, and a
*rejected* twin stops blocking new applications. Profile governance is admin-only and
bounded — timezone validated against `pg_timezone_names` by trigger and constraint,
branding restricted to four allow-listed keys with `#rrggbb`/http(s) checks, notice
capped at 2000 characters — and `estate_config` rule writes are versioned by the
database (revision rows with `previous_value`, newest-first, nothing for untouched
columns). Invite codes now carry a role (`resident` default, `estate_admin` for a
manager) and a resident code cannot demote a sitting owner. Ownership moves only when
the incoming owner accepts, through one `SECURITY DEFINER` writer, and the demoted
former owner keeps membership but loses every admin surface; decline and withdraw both
leave the estate where it was. Suspension and closure are enforced writes, not cosmetic
status text.

14 of 16 M02 rows now carry live evidence (EXEC-ESTA-024…028). The two that remain
BLOCKED are `EST-UAT-0033/0034` (bulk estate/building upload and partial-import
failure) — still `ESTA-D016`, Phase 2.5.

Two limits to read with the PASSED rows: this is the **Go** surface, so nothing here
speaks for the Next.js BFF the mobile app actually calls; and `branding`/`timezone` are
stored, validated and served but no client renders them and no estate code reads the
zone for computation, which is why those rows say so in their notes rather than
claiming a rendered theme or timezone-aware scheduling.

## M03 — Properties, units & occupancy

Closed by Phase 2.4 on 2026-10-27 (`live-2026-10-27/`, `09-probe-occupancy.sh` +
`TestLiveDB_Occupancy_*`; `ESTA-D015` → FIXED and ten new defects found, eight fixed in the slice).
The unit is now a governed object instead of a row with two UUID columns:

- **One admitting writer.** `estate_occupancy_admit` / `estate_occupancy_release` (both
  `SECURITY DEFINER`, both re-checking that the named actor is the JWT holder) are the only way anybody
  occupies or leaves a unit — admin admission, landlord tenancy approval and the admin's direct
  assign/transfer paths all route through them, so capacity, the overlap rule, the archived-unit rule
  and the active-membership rule cannot be bypassed by choosing a different endpoint.
- **Capacity and overlap are countable** (0044): per-unit `capacity` defaulting to 6 under a CHECK of at
  least 1, one current owner and one current tenant per unit enforced by two partial unique indexes, a
  refused admission changing nothing, and `replace_owner` displacing by *release* so the history survives.
  One owner holding many tenant units is allowed, per the product decision taken for this slice.
- **The effective date is load-bearing** (0045, 0040): a future-dated registration is stored and reads
  `in_effect:false`, its holder is refused on the unit while their own register rows stay readable, an
  estate admin is exempt, a dateless term is unrestricted, and the same window decides whether the
  occupant may be billed. The lease dates a tenancy approval used to discard now land on the registration.
- **Dues follow occupancy** (0048, 0045): a vacant unit is exempt and an occupant outside their term is
  exempt, each waivable only by an estate admin filing a reason, and both waivers are audited. The dues
  routes sit behind the platform step-up gate, which was proven closed *and* open (the OTP grant itself
  is seeded — the delivery channel on this stack is email nobody reads).
- **Proof is declared, queued, decided and attributed** (0051, 0039): the declaration stays `unverified`
  until an admin acts, re-filing re-opens the same row rather than queueing twice, replacing the document
  resets the verdict by trigger, self-verification and approving an empty declaration are refused, and an
  approval that would seize a unit somebody else is recorded as owning rolls the whole review back.
- **Move-out is a release, not a delete** (0046, 0052): history and receivables outlive the occupant, the
  register outranks the free-text `occupancy_status` flag, and archive refuses in dependency order
  (occupants → deed owner → open invoices).

Three authz defects were fixed rather than recorded: a claim accepted another estate's unit id
(`ESTA-D030`), vehicle verification updated another estate's plate (`ESTA-D031`), and a tenancy approval
demoted an estate_admin who happened to be the tenant (`ESTA-D034`).

What is *not* closed is stated row by row rather than averaged away: **0047** stays PARTIAL because no
lane runs a successful `RequestPropertyTransfer`/`ReviewPropertyTransfer` (only its refusals are proved),
that path has no effective date and no outgoing-owner consent; **0049** stays PARTIAL because plate
uniqueness is still per-resident, there is no parking-stall model and the gate does not read permitted
plates from this registry; **0050** stays PARTIAL because a *refused* write leaves no audit row at all
(`ESTA-D040`) and `PATCH .../properties/:pid` was never attacked over HTTP; **0037** stays PARTIAL
because a building has no API — no `estate_buildings` table and no service method exist, so "building" is
only a `block`/`floor` string on the unit. `ESTA-D033` (a landlord cannot read the register of the unit
they own, because every non-admin register read is scoped to the caller's own rows) and `ESTA-D039` (filing
a tenancy echoes the unit's real landlord id to a non-member) are deliberately left RECORDED for the
product owner instead of quietly widened. `EST-UAT-0042` (household members with per-policy entitlements)
is untouched by this slice and stays BLOCKED.

Same limits as M02: this is the **Go** surface only — the shipped app calls the Next.js BFF, whose estate
routes are unchanged by this lane; the admitting writers were exercised through the service role, so the
PostgREST path with `authenticated` `EXECUTE` on them is untested; and capacity counts occupancy
registrations, not dependants.

## M04 — RBAC, delegation & tenancy isolation

Binary role model `resident|estate_admin` (CHECK constraint). Tenancy isolation
is real and well-scoped (0053, 0054, 0062, 0063, 0066 — membership re-checked
per request, IDOR guards on code/claim ownership). The delegated-role cases
(0055–0058, 0060, 0061, 0068) are MISSING — the roles do not exist
(ESTA-D011). Platform `estate.admin.*` oversight routes are read-only (0065-
partial). No bulk-export surface exists to abuse (0067 conditional).

## M05 — Visitor invitations & access codes

BFF-implemented. Fixed this lane: window/phone validation, CSPRNG codes,
collision retry, watchlist flag-on-issue (0074–0076, 0100); gate approve now
enforces status/validity/uses/blacklist/issuer-membership with an atomic CAS
consumption claim (0079–0083, 0091, 0094, 0098); new regenerate endpoint
(0084); lookup rate limit + full watchlist matching (0095); offline event
upload with id-dedup and preserved timestamps (0108, 0109). Recorded gaps:
unsigned QR payload (0070/0103), SMS delivery stub (0071), recurrence not
evaluated at gate (0072), no max-validity/quota policy (0077/0078), no
per-gate assignment or identity check (0086/0087), no resident
approve/decline/timeout flow (0088–0090), no PII retention (0097),
service-worker pass not bound to a work order (0099).

## M06 — Gate operations & security desk

Root defect found and fixed: `gate_sessions` had **no write path** — the whole
guard surface was unreachable (ESTA-D001). New `POST /gate/session` validates
estate membership + active gate, closes stale shifts, and attributes the shift
to guard/gate/estate (0101). After the fix, lookup/manual entry (0102),
check-in/out, walk-in, handover + open visits (0111), incidents (0114),
plate capture (0113), and the manual fallback path (0115) are usable. Recorded:
unsigned QR tamper detection (0103), no supervisor-override permission
(0104/0105), offline cache/revocation policy absent (0106/0107), no device
enrollment (0110), no estate emergency posture switch (0112-partial).

## Fixes landed (commits on uat/estate-a)

- `fix(visitor): add gate session sign-in + enforce admission at approve`
- `fix(visitor): validate access-code issuance + regenerate + sync dedup`
- `fix(estate): unit dedup, archive dependency gate, check-in race, deletion hold`
- `test(estate): visitor-gate-uat.spec.ts — 21 specs for the UAT fixes`
- `feat(estate): build the election governance workflow on a secret ballot` — `c4c69e0cd`, Phase 2.2 (M11)
- `feat(estate): put the estate itself under governance` — `b301468a5`, Phase 2.3 (M02 lifecycle, profile,
  configuration history); `git show --stat` on it lists 26 files, all of them estate-a or M02 evidence

**Phase 2.4 (M03) is not committed.** Its surface is the working tree, not a commit: new
`backend/internal/estate/occupancy.go` (656 lines), `occupancy_handler.go` (186) and
`occupancy_live_db_test.go` (832), new `backend/internal/app/estate_occupancy_routes.go` (8 routes, 37
lines) plus the 5 added lines in `estate_profile_routes.go` that call
`RegisterEstateOccupancy(est, h)`, and edits to `handler.go`,
`handler_modules.go`, `model.go`, `model_modules.go`, `property_mgmt.go`, `service.go`, `service_dues.go`,
`service_extras.go`, `import.go` and `notifications_test.go` — 621 insertions / 200 deletions across those
11 tracked files (`git diff --stat HEAD -- backend/internal/estate/` is the authority). Both `internal/app`
files in that list are estate-a's own route-registration files; nothing outside them was touched.

Nothing is pending schema promotion from the earlier waves: the draft that backed ESTA-D004 was promoted on
2026-10-22 (`dc9c4163d`) as `supabase/migrations/20271068000010_estate_properties_unique_unit.sql`,
and `uidx_estate_properties_unit_key` is present in the local database (checked 2026-10-27 via
`docker exec supabase_db_spotlight psql`).

**Runbook rule 5 ("lanes write no migrations") has not held since Phase 2.3, and Phase 2.4 does not
pretend otherwise.** Phase 2.3 committed `20271099000040_estate_profile_governance.sql` and
`20271099000050_estate_invite_roles.sql` in `b301468a5`. Phase 2.4 wrote
`supabase/migrations/20271099000060_estate_occupancy_integrity.sql` (568 lines, additive only — no `DROP`,
no `RENAME`, no type narrowing, no lossy backfill: `estate_unit_occupants`, `capacity` + its positive CHECK,
the two partial unique indexes, the `estate_occupancy_admit`/`estate_occupancy_release` `SECURITY DEFINER`
writers, the vacancy and out-of-term billing triggers, and the `resident_profiles.proof_*` state). It is
applied to the running local database and was re-applied verbatim after the final green HTTP run (exit 0,
19 notices, each one "already exists, skipping" or the pre-existing-signature function not being there),
but it is still **untracked in git**: what is outstanding for it is promotion to a commit, not promotion
to the schema.

## Defects

40 defects in `defects-estate-a.csv` — 23 `FIXED`, 3 `PARTIAL_FIXED`, 14 `RECORDED`;
by severity 5 S1, 20 S2, 15 S3. The 5 S1 are the missing `gate_sessions` write path
(`ESTA-D001`), the gate-approve admission gap (`ESTA-D003`), and the three M03 authorisation defects
the 2026-10-27 Phase 2.4 lane found and closed in the same slice: an ownership claim accepted against
another estate's unit (`ESTA-D030`), a vehicle verification that updated another estate's plate
(`ESTA-D031`) and a tenancy approval that demoted the estate's own admin (`ESTA-D034`). The 3
`PARTIAL_FIXED` are the ones a later wave
half-covered: `ESTA-D011`/`ESTA-D021`/`ESTA-D022` (see the status table in
`SUMMARY.md`) — `ESTA-D010` left that list on 2026-10-27 when Phase 2.3 closed it.
`ESTA-D024`..`ESTA-D027` were recorded during the 2026-10-26 live runs:
flag-gated estate discovery, the lookup branch that can never match, the CSV import
that reports no per-row outcome, and the fixture regression that hid 23 red specs for
five days. `ESTA-D028`/`ESTA-D029` were found by the 2026-10-27 Phase 2.3 HTTP lane
and fixed in the same slice — a whitespace-only estate name that created a live
queued estate, and a class of caller mistakes (over-length notice, unknown query
parameters, unparseable or self transfer target, unknown timezone on create) that
answered 500 instead of 400.
`ESTA-D030`..`ESTA-D040` are the M03 findings, all from the same day's HTTP and live-DB runs.
`FIXED` in Phase 2.4: the two IDORs above, `ESTA-D032` (a `property_type` outside the column domain
surfacing the database CHECK as a 500), `ESTA-D035` (approving an occupancy declaration with nothing
behind it was a 500), `ESTA-D036` (the dues routes answered 403 for *every* service error, so an
exemption refusal looked like a permission failure), `ESTA-D037` (malformed unit/claim ids on the M03
write routes were 500s) and `ESTA-D038` (an unknown `?status=` on the claim queue returned an empty
200). Left `RECORDED` for the product owner rather than quietly widened: `ESTA-D033` (a unit's landlord
cannot read that unit's register — the read is scoped to the caller's own rows for every non-admin),
`ESTA-D039` (filing a tenancy request discloses the unit's real `landlord_id` to a caller who is not a
member), and `ESTA-D040` (a refused estate write leaves no row in `estate_audit_log`, because the audit
call follows the statement that failed). `ESTA-D015` — the occupancy rules engine M03 had been blocked
on since wave 1 — was promoted to `FIXED` on this same evidence.
Those nine `FIXED` rows (`ESTA-D015`, `D030`..`D032`, `D034`..`D038`) carry an **empty `fix_commit`**,
because Phase 2.4 is uncommitted; the hash is written when the slice lands, not before.
The remaining `RECORDED` rows are for orchestration
(largest: delegated role model, resident approval flow, gate policy/device
model — all need schema or cross-lane work).

Shared-platform defects: ESTA-D012 (onboarding lifecycle), ESTA-D014 (vendor
payout verification), ESTA-D018 (SMS delivery) — flagged `shared_platform=yes`.

Shared files touched inside my domain only: Phase 2.3 added
`backend/internal/app/estate_profile_routes.go` (new file, sibling of
`RegisterEstateAdmin`) and one registration line in `finance_routes.go`, which also
carries another session's uncommitted lines — so that file was staged by filtered
index, not wholesale. That slice is commit `b301468a5` (26 files, all estate-a or M02
evidence). Phase 2.4 needed no shared file at all: `RegisterEstateOccupancy` mounts on
the `/estate` group that Phase 2.3's registration already builds, so the only change
outside `internal/estate` is 5 lines in `estate_profile_routes.go`, a file this lane
owns. `finance_routes.go` still carries 56 uncommitted lines from other sessions
(telemedicine admin consoles, health VCN presigning, association push, and an
`/api/v1/estate/properties` block paired with an untracked `v1_handler.go` — that v1
surface is **not** this lane's work and is not counted in the M03 evidence); Phase 2.4
neither edited nor staged it. No other session's file was touched.
