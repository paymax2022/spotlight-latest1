# estate-a live lane — 2026-10-27 (Phase 2.3: estate profile, invitations, ownership governance · Phase 2.4: unit occupancy, capacity, dues exemptions, proof review)

The sections below up to "Boundaries of this evidence" are the **Phase 2.3 (M02)** record. The
**Phase 2.4 (M03)** record is the block at the end, and re-uses this directory's `01-signin.sh` and
`02-grant-reviewer.sql` unchanged.

Executes the **M02 estate governance** cases (EST-UAT-0021…0032, 0035, 0036) against a **running Go
backend** and against the **live local database**, then fixes what the live surface refuses to do
correctly. EST-UAT-0033/0034 (bulk estate/building import) are not this slice — they stay open as
`ESTA-D016` and belong to Phase 2.5.

## Environment (all local, nothing production-reachable)

| Component | Value |
|---|---|
| Supabase local stack | `supabase_db_spotlight` (db `127.0.0.1:54322`) |
| Go backend | `APP_PORT=8095`, binary built to `/tmp/estate-uat-live/server-phase23.exe` (never into the repo) |
| Flags forced for this lane | `FEATURE_ESTATE_ENABLED=true`, `FEATURE_ESTATE_LIFECYCLE_ENABLED=true`, `FEATURE_ESTATE_VERIFICATION_REQUIRED=true` |
| Start command | `bash docs/qa/estate-uat-443/live-2026-10-27/03-run-server.sh` |
| HEAD | The lane ran on top of `c45660cde` and is itself commit `b301468a5` (profile service + handler + routes, both migrations, this evidence directory and the re-marked estate-a ledger). The working tree also carries other sessions' unrelated edits (`internal/app/finance_routes.go` association-push/kv lines, `internal/association/**`, `internal/stays/**`, `internal/maps/**`, `kycverify`, `restaurant`, and an untracked `internal/estate/v1_handler.go`) — this lane touched none of them, and `finance_routes.go` went in with only its three `RegisterEstateProfile` lines. |

Port 8095 is deliberate: 8091/8093/8094 carry long-running local dev instances from other sessions,
and a lane that restarts a server must not disturb them.

`FEATURE_ESTATE_VERIFICATION_REQUIRED=true` is what makes the *pending → review → active* posture
reachable over HTTP at all; with the shipped default (off) an estate is created `active` and the
review queue never has an occupant.

## Schema

`supabase/migrations/20271099000040_estate_profile_governance.sql` (additive: `estates.timezone` /
`branding` / `notice` / `duplicate_suspected`, `estate_config_revisions` + its AFTER trigger,
`estate_owner_transfers` + one-pending partial unique + the single `SECURITY DEFINER` writer
`estate_owner_transfer_decide`) and `20271099000050_estate_invite_roles.sql`
(`estate_invite_codes.role`, CHECK-limited to `resident|estate_admin`, default `resident`).

Both were re-applied verbatim through `docker exec -i supabase_db_spotlight psql -v ON_ERROR_STOP=1`
and returned 0 with only `already exists, skipping` notices — no destructive step in the path. After
the re-apply: both triggers present, `estate_owner_transfer_decide` still `prosecdef = t`, both new
tables `relrowsecurity = t`, and the invite-role CHECK intact
(`EXEC-ESTA-024`).

## Identities and data

`01-signin.sh` re-signs the four local GoTrue users the 2026-10-26 lane created
(`estate-uat-{admin,guard,resident,outsider}@local.test`) and caches bearer JWTs **outside the repo**
(`/tmp/estate-uat-live/tokens`).

`02-grant-reviewer.sql` is the one data change the platform-queue cases need: a
`NOT EXISTS`-guarded `user_permissions` allow/global grant of `estate.admin.lifecycle` to
`estate-uat-admin@local.test` (`7945fbd0-24bf-4ee0-9de4-de37aa51fa21`), because **no local user held
any `estate.%` platform permission** and the queue is reviewer-only RBAC. Applied locally
(`INSERT 0 1`, verified `user_has_permission = t`); the undo `DELETE` is in the same file.

## What was executed

| Script | Transcript | Result |
|---|---|---|
| `go test ./internal/estate/ -count=1 -run 'TestLiveDB_Profile\|TestLiveDB_Invite\|TestLiveDB_OwnerTransfer' -v` | `livedb-estate-profile-phase2.3.out` (gitignored twin: `.log`) | **10 PASS / 0 FAIL / 0 SKIP** (`ok … 17.277s`) |
| `07-probe-profile.sh` — 10 sections, 140 HTTP assertions | `probe-profile.out` | **140 PASS / 0 FAIL** |
| `go test ./internal/estate/... -count=1 -v` — whole package, after the two fixes and the migration re-apply | `livedb-full-suite-phase2.3.out` | **173 top-level PASS + 50 subtests / 0 FAIL / 0 SKIP** (estate 115.343s, paystackcheckout 2.126s) |

The first probe run of this lane reported **136 PASS / 4 FAIL**; the transcript was overwritten by
the clean re-run after the fixes. Every one of those four was investigated: two were product defects
(listed below, now fixed), one was a wrong premise in the probe itself (`Europe/Nairobi` is not an
IANA zone — the real zone is `Africa/Nairobi`; the server's `400` refusal was correct behaviour).

## What the live HTTP surface actually enforces

1. **An application is not an estate.** `POST /api/finance/estate` with
   `FEATURE_ESTATE_VERIFICATION_REQUIRED=true` returns `201` with `status:"pending"`, the creator as
   `admin_id`, and `timezone` defaulted to the platform zone. A missing name, a 1-character name, a
   whitespace-only name and an unknown zone are all `400` with the reason in the message.
2. **Nothing is writable before publish.** Every mutating `/estate/:id/**` call on a pending estate
   is `423` with `"code":"ESTATE_NOT_ACTIVE"` and `"estate_status":"pending"` — including by the
   estate's own owner. Reads stay open.
3. **The review queue is RBAC-gated and transitions are audited.** `/estate-admin/estates` is `403`
   for a plain member, `200` for the granted reviewer; unknown `status`/`action` are `400`; a reason
   under 5 characters is `400`; `suspend` straight from `pending` is `409`; `verify` moves the estate
   to `active` and writes the actor-attributed status change, after which profile writes succeed.
4. **A normalised twin is reviewed, not published.** Same name with different case/whitespace and the
   same address → `201` with `duplicate_suspected:"true"` and `pending`, and it appears in the pending
   queue. `reject` closes it, and re-applying over a **rejected** twin is not flagged again (`duplicate_suspected`
   empty) — a rejected application cannot lock a real one out of the platform.
5. **Profile writes are admin-only and bounded.** Non-member and unknown-estate reads/writes are `403
   estate: not a member of this estate`; a malformed id is `400`; only IANA zones in
   `pg_timezone_names` are accepted (`Africa/Nairobi` `200`, `Not/AZone` `400`); branding is an
   allow-list (`logo_url`, `primary_color`, `accent_color`, `banner_url`) of `#rrggbb` / http(s)
   strings, with unknown keys, bad colours, non-string values and non-http schemes all `400`; the
   resident notice is capped at 2000 **characters** (2001 → `400`); clearing branding returns the
   estate to defaults.
6. **Invite codes carry a role.** Unknown role and missing `max_uses` are `400`; a `resident` code
   joins a member as `resident` and that member gets no admin surface (`403 estate: insufficient
   role`) while still reading the estate profile; a code with the role omitted defaults to `resident`;
   an `estate_admin` code promotes a joiner, and redeeming a resident code as the **owner** does not
   demote them (`estate_admin` retained).
7. **Governance rules are versioned by the database.** An unknown `column` filter is `400`, and an
   untouched column has **no** phantom revision (empty history). Two rule writes produce `v2`
   newest-first with `previous_value` from the write it replaced, and `v1` with no previous value —
   written by the AFTER trigger on `estate_config`, not by the caller.
8. **Ownership moves only on accept.** Opening a handover (`201 pending`) changes nothing; a second
   open offer is `409`; a non-member target and a plain-member requester are both `403`; an unrelated
   member and the outgoing owner are both refused the decision (`403 … not a party` / `403 only the
   incoming owner can accept`); a decision posted under the **wrong estate path** is `404` and moves
   nothing; only the incoming owner's `accept` changes `estates.admin_id`. A decided transfer is then
   `409 already been decided`, and the demoted former owner keeps membership but loses every admin
   surface (`403` on governance history, opening a handover, editing the notice) and sees only offers
   addressed to them. `decline` and owner `withdraw` both leave ownership where it was, and an
   `estate_admin` member sees the estate's whole newest-first history.
9. **Suspension and closure are enforced, not cosmetic.** While `suspended`, profile writes,
   handovers and even joining are `423`; the estate stays readable with its reason; `verify` from
   `suspended` is `409`; `reactivate` restores writes; `close` is terminal (re-close → `409`).

## Defects this lane found and fixed

- **EST-UAT-0022 — `POST /api/finance/estate` accepted a name made of spaces.** Gin's
  `binding:"required,min=2"` counts three spaces as a name, so `{"name":"   "}` returned `201` and
  queued a live estate. `CreateEstate` now trims, requires ≥2 **runes**, refuses with
  `ErrEstateNameRequired` → `400`, stores the trimmed name, and uses that trimmed value for the
  duplicate lookup (so padding cannot smuggle a twin past the check). Recorded as `ESTA-D028`.
- **A class of caller mistakes returned 500 instead of 400.** Over-length notice, unknown
  `column`/`status` query parameters, an unparseable or self `to_user_id`, and an unknown timezone on
  create all surfaced as server failures. Each now has a sentinel (`ErrNoticeTooLong`,
  `ErrInvalidConfigColumn`, `ErrInvalidTransferFilter`, `ErrInvalidTransferTargetUser`,
  `ErrOwnerTransferToSelf`) mapped to `400` in `profile_handler.go` / `handler.go`. Recorded as
  `ESTA-D029`.

The `   `-named estate the first run created (`43543a7e-7ae9-4c7a-9707-952d74812406`) was not deleted
out from under the ledger — it was closed over the real `reject` transition (`200`).

## State left behind

Every estate this lane created is `closed` (teardown section 10). `psql` after the run:
`estates → 9 closed / 1 active`, and the single active estate is the pre-existing 2026-10-26 seed
`UAT Gate Estate Alpha` (`0a1e5701-…-0001`), which other lanes use. Child rows accumulate and are
local test data only: `estate_config_revisions=4`, `estate_owner_transfers=6` (2 accepted / 2
declined / 2 cancelled), `estate_invite_codes=4` (2 with `role='estate_admin'`) — counts cover both
probe runs. Teardown afterwards: the `estate.admin.lifecycle` grant was removed with the undo
`DELETE` in `02-grant-reviewer.sql` (`DELETE 1`, and `user_has_permission` returns `f` again), the
scratch backend on `:8095` was stopped and its binary deleted, and the `:8091`/`:8093`/`:8094`
instances from other sessions were left running. Re-applying the grant for a later flag-on lane is
one `psql -f -` command.

## Boundaries of this evidence (read before re-marking anything)

- Both lanes cover the **Go** surface (`/api/finance/estate/**`, `/api/finance/estate-admin/estates/**`).
  The shipped mobile app calls the **Next.js BFF**, which has its own estate routes; nothing here
  proves BFF behaviour, and no BFF row should be re-marked from this lane.
- Everything in section 2, 3, 4 and 9 depends on `FEATURE_ESTATE_VERIFICATION_REQUIRED` and
  `FEATURE_ESTATE_LIFECYCLE_ENABLED`, both **false by default**. Proved capability, not shipped
  posture.
- The `estate.admin.lifecycle` grant was created for this lane. It proves the RBAC gate works; it is
  not evidence that a reviewer role exists in any seeded or shipped permission set.
- Lifecycle writes honour the documented exemption list (SOS + its status updates, guard incident
  reports, guard checkout/sync, access-code revoke/blacklist, offline log sync, legacy import). This
  lane asserts the *blocked* side; the exempt side is asserted by the 2026-10-26 lane.
- A handover transfers the **estate** (`estates.admin_id`). Per-unit ownership transfer is a different
  model and is not built; that is called out on the EST-UAT-0035 row rather than glossed over.
- `estate_config_revisions` records only writes that change a value (an empty-default `INSERT` records
  nothing) — proven by the empty-history assertion, and it means history is not a full audit trail of
  every config call.

---

# Phase 2.4 — unit occupancy, capacity, term gating, dues exemptions, proof review (estate-a M03)

Executes **EST-UAT-0038, 0043, 0044, 0045, 0046, 0047, 0048, 0049, 0050, 0051, 0052** — the unit
occupancy registry, its capacity/overlap rule, the term gate on access and dues, the two billing
exemptions, proof-of-occupancy review, tenancy approval and the unit retirement gates — against a
running Go backend and the live local database, then fixes what the live surface gets wrong.

## Environment

| Component | Value |
|---|---|
| Supabase local stack | `supabase_db_spotlight` (db `127.0.0.1:54322`) — same instance as Phase 2.3 |
| Go backend | `APP_PORT=8095`, binary built to `/tmp/estate-uat-live/server-phase24.exe` (distinct name so a 2.4 run can never be taken against a stale 2.3 build) |
| Flags forced | `FEATURE_ESTATE_ENABLED=true`, `FEATURE_ESTATE_LIFECYCLE_ENABLED=true`, `FEATURE_ESTATE_VERIFICATION_REQUIRED=true` |
| Step-up middleware | enabled as shipped on this stack: `ttl=5m0s enforce=true`, `[otp] routes enabled` |
| Dual control | `FEATURE_ESTATE_DUAL_CONTROL_ENABLED` left at its shipped default (off), so `ban` is a direct `200` rather than a two-person release |
| Start command | `bash docs/qa/estate-uat-443/live-2026-10-27/08-run-server-occupancy.sh` |
| Probe command | `bash docs/qa/estate-uat-443/live-2026-10-27/09-probe-occupancy.sh` (transcript: `probe-occupancy.out`, run stamped `2026-10-27T23:02:30Z`) |

The identities are the same four local GoTrue users as Phase 2.3, re-signed by `01-signin.sh` into
`/tmp/estate-uat-live/tokens`, and the platform reviewer grant is the same `02-grant-reviewer.sql` —
this lane needs it because publishing the estate it creates (a precondition for any occupancy write)
goes through the RBAC-gated `/estate-admin/estates/:id/lifecycle` route.

## Schema

`supabase/migrations/20271099000060_estate_occupancy_integrity.sql` — additive: `estate_properties.capacity`
(`NOT NULL DEFAULT 6`, `CHECK (capacity > 0)`), the new `estate_unit_occupants` registry (one row per
unit and person, `UNIQUE (property_id, user_id)`, window-ordered CHECK, and the overlap rule as two
**partial unique indexes**: one live `homeowner` and one live `tenant` per unit), `estate_dues_invoices.vacancy_override*`
/ `term_override*` with the "an override needs a reason" CHECKs, `resident_profiles.proof_*` with its
state CHECK, and `tenancy_requests.reviewed_by` / `reject_reason`. Four enforcing triggers
(`estate_enforce_unit_capacity`, `estate_enforce_vacant_unit_exemption`, `estate_enforce_out_of_term_billing`,
`estate_reset_proof_on_redeclaration`) and the two `SECURITY DEFINER` single writers
`estate_occupancy_admit` / `estate_occupancy_release`.

Re-applied verbatim through `docker exec -i supabase_db_spotlight psql -v ON_ERROR_STOP=1` — after the
final green HTTP pass, to show the path is idempotent — and it returned 0 with only
`already exists, skipping` notices (`migration-reapply-occupancy-phase2.4.out`; the only `DROP` statements
in the file are `DROP TRIGGER/FUNCTION/POLICY IF EXISTS` ahead of their own re-create, and no data
statement is in the path). The post-re-apply inspection (`schema-occupancy-phase2.4.out`) reads:
`estate_unit_occupants` `relrowsecurity = t` with only the `occupancy_service` `service_role` policy, all
four triggers present and calling the documented functions, both writers `prosecdef = t` owned by
`postgres`, the six registry indexes including the two partial uniques, the capacity default and every
override/proof column with its expected default or CHECK.

## What was executed

| Script | Transcript | Result |
|---|---|---|
| `go test ./internal/estate/ -count=1 -run 'TestLiveDB_Occupancy' -v` | `livedb-estate-occupancy-phase2.4.out` (gitignored twin: `.log`) | **8 PASS / 0 FAIL / 0 SKIP** (`ok … 10.857s`) |
| `09-probe-occupancy.sh` — 26 sections, 264 HTTP assertions | `probe-occupancy.out` | **264 PASS / 0 FAIL** |
| `go test ./internal/estate/... -count=1 -v` — whole package with the live database, after every fix in this slice | `livedb-full-suite-phase2.4.out` | **181 top-level PASS + 50 subtests / 0 FAIL / 0 SKIP** (estate 33.092s, paystackcheckout 1.800s) |

`go build ./...` clean; `go vet ./internal/estate/... ./internal/app/...` clean.

The first run of the probe was **92 PASS / 142 FAIL** and the second **245 PASS / 12 FAIL**. Both were
investigated line by line rather than re-rolled until green, and the failures split into two kinds:

- **Product defects** — a `property_type` outside the column domain died on the database CHECK and came
  back `500` (and poisoned every later assertion in the run, because the unit id never came back);
  a malformed unit/claim id in the path was a `500`; the dues routes answered *every* service error with
  a hard-coded `403`; an unknown `?status=` on the claim queue was an empty `200`; `ErrProofNeedsDocument`
  was unmapped. All fixed, listed below.
- **Wrong premises in the probe itself** — `"property_type":"flat"` is not one of the five values the
  column allows (`apartment|house|commercial|land|other`); a member whose term starts tomorrow is *not*
  refused the register read (that read is the record explaining the door, by design); a grant seeded for
  an earlier section is still live when a later section tries to prove the same gate closed; and the
  release response identifies the **registration row** (`occupant_id`), not the person. Each assertion was
  corrected to the behaviour the code documents, and the corrected expectations are what passed.

## What the live HTTP surface actually enforces

1. **No occupancy before an estate exists as one.** With verification required, `POST /api/finance/estate`
   returns `201 pending` and every `/estate/:id/properties*` write is `423` with `"code":"ESTATE_NOT_ACTIVE"`;
   `verify` publishes it and the same writes succeed.
2. **A unit's keys and its birth state (EST-UAT-0038, 0044).** Duplicate `unit_label` inside an estate is
   `409`; capacity defaults to 6 and the unit is born `vacant`; a `property_type` outside the domain is a
   `400` naming the field, and a padded valid type is stored trimmed; `PATCH …/capacity` is admin-only
   (`403` for a member) and `capacity` of `0` or missing is `400`.
3. **One admission writes the whole picture (EST-UAT-0043, 0046).** `POST …/occupants` writes the
   registration, the unit's `landlord_id` (owner kinds) and recomputes `occupancy_status` in the same
   statement; releasing keeps the row (`ended_at`), frees the slot and returns the unit to `vacant`, and
   the closed registration is still readable with `include_ended=true`. Releasing a person who does not
   occupy the unit is `404`; a non-member cannot read the register (`403`); a malformed unit id is `400`;
   unknown occupancy kind, an out-of-order window, a non-ISO date and a missing/malformed `user_id` are
   all `400` with the reason, not `500`.
4. **Capacity and overlap are countable (EST-UAT-0044).** A third registration in a capacity-2 unit is
   `409 "this unit is already at capacity"` and changes nothing (the register still lists two); lowering
   capacity below who already lives there is `400` naming the recorded count, raising it is `200` and the
   next admission succeeds. A second current owner is `409` naming the owner already on the deed unless the
   caller says `replace_owner`, and a displacement **releases** the old owner rather than deleting them.
   The landlord's own privilege is exactly one thing: admit a **tenant** into the unit they own — a
   homeowner or resident admission by the landlord is `403`.
5. **The term gates access, not the record (EST-UAT-0045).** A registration dated to start in the future
   is stored and reads back `in_effect:false`; that member gets `403 "your occupancy of this unit is not in
   effect today"` on the unit itself, and still reads their own register rows — both estate-wide and
   per-unit — with **only** their own rows in them. A dateless registration is unrestricted, an in-term one
   admits, and an estate admin is exempt from the gate.
6. **The platform step-up gate is in front of the dues routes.** `POST …/dues/invoices` with no completed
   second factor is `403` with `"step_up_required"` — before any estate rule runs; with a grant it reaches
   the estate's own rule. The same gate is shown closed a second time on the ban route after the grant is
   expired, so the proof is not a one-way artefact of ordering.
7. **A vacant unit is exempt from dues (EST-UAT-0048).** Billing a vacant unit is `409 "dues are exempt for
   a vacant unit"`; an override without a written reason is `400`; a reasoned override bills (`201`) and the
   invoice carries both the flag and the reason; once the unit has an occupant, a plain invoice succeeds;
   a *different* vacant unit is still exempt. A member who has stepped up is still `403 "insufficient role"`
   — the gate is not the estate's role check — and a `0` or negative `amount_kobo` is a `400` naming the field.
8. **A member outside their term is not charged (EST-UAT-0045, dues half).** Invoicing an occupant whose
   term on the unit is not running is `409` naming the term exemption, a reasoned `term_override` bills
   anyway, and both waivers land in the estate audit log next to the admissions and releases
   (`ESTATE_UNIT_OCCUPANT_ADMITTED` / `_RELEASED`, `INVOICE_VACANCY_OVERRIDE`, `INVOICE_TERM_OVERRIDE`).
   The audit log is admin-only (`403` for a member).
9. **Proof of occupancy is declared, queued, decided and attributed (EST-UAT-0051).** A profile declaration
   is `unverified` until an estate admin acts; the claim queue is admin-only (member `403`, unknown
   `?status=` `400`) and re-filing the same claim re-opens the existing row instead of queueing twice
   (id stable across the re-file); approving sets the unit's `landlord_id`, marks the declaration `verified`
   and records the reviewer identity and note; re-reviewing a decided claim is `409`; a claim id from
   another estate is `404`; a member asking for somebody else's proof file is silently scoped to their own
   (the `user_id` parameter is ignored, not obeyed); an approval cannot seize a unit another member is
   recorded as owning — the `409` rolls the whole review back and the claim stays pending until it is
   honestly rejected. Filing a **different** document resets the verdict to `unverified` with the reviewer
   detached (database trigger), self-verification is `403`, an unknown decision is `400`, an empty
   declaration cannot be approved (`409 "there is no document on record to verify"`), an id this estate has
   no registration for is `404`, and a rejection keeps the reason readable by the resident.
10. **A tenancy approval admits, attributes and demotes nobody (EST-UAT-0047).** Filing binds the request to
    the path estate and the unit's **real** `landlord_id` (the body's value is ignored and the response
    discloses the true one — see `ESTA-D039`); a unit with nobody on the deed has no reviewer, so filing is
    `409` instead of queueing an orphan. Only that landlord can decide it, and only through the unit path it
    was filed against: another estate admin, a plain member, the tenant (even when the tenant *is* an estate
    admin) and the right landlord on the wrong unit path are all `404`. Approval admits the tenant over the
    lease window, writes the unit's `tenant_id`, marks the agreement a checked document, records
    `reviewed_by`, and leaves the admin's `estate_admin` role intact — the demotion defect is gone, proven
    from the admin list, the unit admin surface and the review queue. A decided request cannot be re-decided.
11. **The register outranks the flag (EST-UAT-0052).** Setting `occupancy_status=vacant` on a unit with
    registrations is `409` naming how many, an invented status is `400`, the flag is admin-only, and an empty
    unit can still be `reserved`. Archiving refuses in order — live occupants, then the deed owner, then open
    invoices (`409 … settle or waive them first: 2 pending or overdue`) — and a retired unit takes no further
    admissions or claims (`404`) while its label becomes reusable by a live unit. Unit analytics keep reading
    for a live unit.
12. **A banned membership is not revived by an admission.** After `ban` (past the step-up gate) an admission
    is `403 "this estate membership is no longer active"` — the unit is not the reason — and after `restore`
    the same admission succeeds.
13. **Another estate's id is not a capability.** A second estate's unit, claim, occupancy-proof and vehicle
    ids are `404` on every M03 route, including the two that were IDORs before this slice; a vehicle verdict
    does not survive the document it was based on (replacing the document revokes it); the resident card
    carries the proof state a guard reads (`verified` with the reviewer), and a person cannot claim a unit
    in an estate they are not a member of.
14. **Teardown is a real transition.** Every registration is released by someone entitled, both probe
    estates `close` (`200`), reopening over HTTP is `403` (no lifecycle permission for an estate admin
    without the platform grant) and closing an already-closed estate is `409`.

## Defects this slice found, and what became of them

| Id | What was wrong | Status |
|---|---|---|
| `ESTA-D030` | `ClaimOwnership` took any `property_id` from the body without binding it to the path estate, so a member of estate A could queue an ownership claim against a unit in estate B | FIXED — the unit must exist, live and inside the path estate (`ErrUnitNotFound` → `404`); proved by the cross-estate section of the probe and `TestLiveDB_Occupancy_*` |
| `ESTA-D031` | `VerifyVehicle` updated `resident_vehicles` by id alone, so an estate admin could verify another estate's plate | FIXED — the update joins through `estate_residents` on the path estate and reports `404` when nothing matches |
| `ESTA-D032` | A `property_type` outside the column domain surfaced as `500` (the database CHECK error was returned raw) | FIXED — `PropertyTypes` is now one Go-side domain shared by create, update **and** import, trimmed before the check, and `ErrInvalidPropertyType` → `400` naming the field |
| `ESTA-D033` | A unit's landlord cannot read that unit's occupancy register — the register read is scoped to the caller's own rows for every non-admin | RECORDED — deliberate personal-data scoping, but it means the landlord who just approved a tenancy cannot read the admission back; left to the product owner rather than quietly widened |
| `ESTA-D034` | Approving a tenancy upserted the tenant as `estate_admin`→`resident` with `ON CONFLICT DO UPDATE SET role='resident'`, so a landlord approving an admin's tenancy **demoted the estate's admin** | FIXED — approval goes through `estate_occupancy_admit`, which is promotion-only and never revives a banned or deleted membership |
| `ESTA-D035` | `ErrProofNeedsDocument` was unmapped, so "approve an empty declaration" was a `500` | FIXED — mapped to `409` and asserted live |
| `ESTA-D036` | The dues handlers hard-coded `403` for **every** service error, so an exemption (`409`), an override without a reason and a bad amount all reported an authorisation failure | FIXED — they now share `writeOccupancyError`, so exemptions stay `409`, caller mistakes stay `400`, and only role failures are `403` |
| `ESTA-D037` | A malformed unit/claim id on the M03 write routes reached the database and returned `500` | FIXED — `validUUIDParam` shape checks on the claim, tenancy, status, archive and review routes → `400` |
| `ESTA-D038` | An unknown `?status=` on the ownership-claims queue returned an empty `200`, so a typo read as "nothing to review" | FIXED — `ErrInvalidClaimFilter` → `400` with the three allowed values |
| `ESTA-D039` | Filing a tenancy request returns the unit's real `landlord_id`, which discloses an owner's user id to a person who is not a member of the estate | RECORDED — the filing itself needs no membership (proved intentional in the probe); the disclosure is the residue, and whether the response should be trimmed is the product owner's call |

## State left behind

All 8 estates the occupancy lane created (two per probe run, four runs) are `closed`. `psql` after the
teardown:
`estate_unit_occupants` → **0 live rows** / 60 historical rows on those estates, `estate_properties` →
42 units of which 3 are archived, `estate_dues_invoices` → 12 `pending` (the receivables the archive-gate
cases deliberately left outstanding — arrears do not evaporate with the occupant), `property_ownership_claims`
→ 3 `approved` / 3 `rejected`, `tenancy_requests` → 3 `approved` / 6 `pending` (the negative cases that were
never decided), `estate_audit_log` → 180 rows. Nothing was deleted to make the ledger read clean.

Teardown afterwards: the 2 seeded `auth_step_up_grants` rows (`user_agent='estate-occupancy-lane'`) were
deleted (count now 0), the `estate.admin.lifecycle` grant was removed with the undo `DELETE` in
`02-grant-reviewer.sql` (`user_has_permission` returns `f` again), the scratch backend on `:8095` was
stopped and `server-phase24.exe` deleted, and the `:8091`/`:8093`/`:8094` instances from other sessions
were left running.

## Boundaries of this Phase 2.4 evidence

- It covers the **Go** surface (`/api/finance/estate/**`). The shipped mobile app and the admin console
  call the **Next.js BFF**, which has its own estate routes; no BFF row should be re-marked from this lane.
- The dues and ban routes sit behind the platform step-up gate, whose only delivery channel on this stack
  is Brevo email to an address nobody reads. `seed_stepup` writes the grant row a completed challenge would
  have written (sha256 of the bearer token, `method='email_otp'`), so the **refusal** and the **pass-through
  both run through the real middleware**. What this does *not* prove is that the OTP challenge delivers.
- Everything here needs `FEATURE_ESTATE_LIFECYCLE_ENABLED` and
  `FEATURE_ESTATE_VERIFICATION_REQUIRED` (both false by default), plus the reviewer grant. Proved
  capability, not shipped posture.
- Capacity counts **occupancy registrations**. Dependants in `household_members` / `domestic_staff` do not
  consume a bed, and pre-existing `estate_residents` rows were given no registration — a member with no
  row is treated as unrestricted, which is the EST-UAT-0045 rule rather than a gap to backfill from a
  free-text unit label.
- The vacancy and term exemptions are enforced **on INSERT**. A unit that goes vacant after being billed
  keeps its receivable; that is the documented rule and the probe leaves 12 such invoices pending on
  purpose.
- `estate_occupancy_admit` / `estate_occupancy_release` are `SECURITY DEFINER` and, on this database, also
  `EXECUTE`-granted to `authenticated`. The function body refuses when the named actor is not the JWT
  holder (`auth.uid() <> p_actor`), which is the right guard — but this lane exercised them only through
  the service role, so the PostgREST path itself is untested evidence and belongs to a later row.
- The tenancy surface is verified as a **decision workflow** (file → decide → admit). Rent payment,
  renewal and deposit handling are elsewhere in the estate module and are not claimed here.
