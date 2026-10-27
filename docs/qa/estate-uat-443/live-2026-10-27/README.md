# estate-a live lane — 2026-10-27 (Phase 2.3: estate profile, invitations, ownership governance)

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
| HEAD | `c45660cde`. The working tree also carries other sessions' unrelated edits (`internal/app/finance_routes.go` association-push/kv lines, `internal/association/**`, `internal/stays/**`, `internal/maps/**`, `kycverify`, `restaurant`, and an untracked `internal/estate/v1_handler.go`) — this lane touched none of them. |

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
probe runs. The `estate.admin.lifecycle` grant is still in place; `02-grant-reviewer.sql` carries the
undo `DELETE`.

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
