# estate-d live lane — 2026-10-28 (Phase 2.5a: notification inbox archive, search, pin, retention)

Closes **EST-UAT-0359** (M18 "in-app inbox retention", P1) and defect **ESTD-D008**, plus the BFF half of
**ESTD-D025** that this lane exposed. The case was raised against the mobile app, which talks to the Next.js
BFF, while the retention semantics live in the Go estate service — so the lane drives **both surfaces** and
records where they agree and where they deliberately do not. A rule proven on one surface only is half a rule.

Both HTTP halves pass with zero failures:

| transcript | surface | assertions | result |
|---|---|---|---|
| `probe-notifications-phase2.5a.out` | Go `/api/finance/estate/:id/**` on `:8095` | 204 | **PASS=204 FAIL=0** (16 sections, 08:20Z, estate `870c4df4-7618-49f7-a267-98e186ca65a1`) |
| `probe-notifications-bff-phase2.5a.out` | BFF `/api/v1/estate/**` on `:3000` | 327 | **PASS=327 FAIL=0** (20 sections, 10:09Z, stamp `20261028100950`, estate `7c0729c3-3040-49e2-a48b-60bc8377d720`) |
| `livedb-notifications-phase2.5a.out` | Go service straight against the local DB | 10 tests | **PASS=10 FAIL=0 SKIP=0** (08:26Z) |
| `schema-notifications-phase2.5a.out` | the promoted migration as it exists in the running DB | 8 checks | columns, indexes, policy RLS + CHECKs, guard trigger, function ACLs, argument default |
| `migration-reapply-phase2.5a.out` | re-apply of `20271099000070` over the existing schema | — | idempotent; `prosecdef` flags re-read |
| `teardown-phase2.5a.out` | `09-teardown.sql` after the green run | — | notifications/policies/memberships/estates-still-open all 0; 75 audit rows kept |

---

## Environment (all local, nothing production-reachable)

- Postgres + PostgREST + GoTrue from the shared local Supabase stack: container `supabase_db_spotlight`,
  DB `postgresql://postgres:postgres@localhost:54322/postgres`, HTTP `http://127.0.0.1:54321`.
- **Go surface**: `05-run-server.sh` builds `./cmd/server` to `/tmp/estate-uat-live/server-phase25a.exe` — a
  distinct binary name so this lane can never be run against a Phase 2.3/2.4 build — and starts it on `:8095`
  with `FEATURE_ESTATE_ENABLED=true FEATURE_ESTATE_LIFECYCLE_ENABLED=true FEATURE_ESTATE_VERIFICATION_REQUIRED=true`
  (the third flag is what makes a freshly-created estate `pending`, which the lifecycle half of the lane needs).
- **BFF surface**: the Next 16.4.3 dev server this checkout owns, on `:3000`. `08b-run-web.sh` resolves the
  surface instead of assuming it: it reads `frontend-web/.next/dev/lock`, requires the listening PID to be the
  lock's PID and that process's command line to point at *this* `frontend-web` directory, then requires the
  route to answer 401 unauthenticated before it hands `BASE` to the probe. A second `next dev` for the same
  project directory is not startable (the lock is the product's own single-instance rule), so verification —
  not a competing server — is the honest way to prove which code answered.
- Ports `:3001`, `:8091`, `:8093`, `:8094` belong to other sessions' long-running dev instances and were not
  touched. Tokens and response bodies stay in gitignored `/tmp/estate-uat-live/`.

## Schema

`supabase/migrations/20271099000070_estate_notifications_archive.sql` — promoted from the lane draft
`docs/qa/estate-uat-443/migrations-estate-d/estate_notifications_archive.pending.sql`, which was retired to a
pointer note once the real file existed. Additive only; read back from the running database in
`schema-notifications-phase2.5a.out`:

- `estate_notifications.archived_at TIMESTAMPTZ NULL`, `estate_notifications.pinned BOOLEAN NOT NULL DEFAULT false`.
- Partial indexes for both halves (`…_user_active` WHERE `archived_at IS NULL`, `…_user_archived` WHERE NOT NULL),
  the unread index, and a `gin_trgm_ops` index over `title || ' ' || body` for search — the transcript also
  records whether `pg_trgm` is actually installed in this stack, so "search is indexed" is a fact about the
  environment rather than an assumption about the DDL.
- `estate_notification_retention_policies`: one row per estate, `enabled`, `archive_after_days` (default 90,
  `CHECK > 0`), `purge_after_days` (nullable — **NULL means never**, `CHECK > 0` when set, and
  `CHECK purge >= archive`), `keep_categories` (default `{security,system}`), RLS enabled.
- `estate_notifications_apply_retention(p_estate_id UUID DEFAULT NULL)` and
  `estate_notifications_retention_for_estate(...)` — both `SECURITY DEFINER`, EXECUTE restricted to `service_role`.
  The argumentless form sweeps every estate under its own policy.
- `estate_notifications_block_purge()` as a `BEFORE DELETE … FOR EACH ROW` trigger, so a pinned row, a
  protected category, or an estate under legal hold cannot be deleted by **any** path — including this lane's
  own teardown and a hand-run `DELETE`.

## Identities and data

`01-signin.sh` re-signs the long-lived UAT users and creates the lane's three inbox identities. The lane
identities exist because of how the BFF resolves an estate:

- Every BFF estate route calls `getResidentContext()`, which reads the caller's estate as
  `.eq('user_id', …).limit(1)` **with no ORDER BY**. The shared identities carry memberships from earlier lanes
  (admin 14, resident 11, outsider 5), so an assertion driven through them tests whichever row Postgres
  returned first. `inboxres` / `inboxadmin` hold exactly one membership each and `inboxnone` holds none, and
  section 1 of the probe asserts 1 / 1 / 0 **before** any HTTP assertion is allowed to run — that preflight
  aborts (`exit 91`) rather than producing a transcript of false evidence.
- The Go surface takes the estate from the path (`/estate/:id/…`), so the shared identities are unambiguous
  there and the Go lane uses them (`admin`, `resident`, `guard`, plus `nobody` as the non-member).
- Fixtures (`07-seed-notifications-bff.sql`, mirrored by `04-seed-notifications.sql` for Go): one lane estate
  created `pending`, labelled rows 01/02/03/05/06/07/08 and archived rows 11/12/13/14, the admin's own copy
  (21), 60 bulk rows one minute apart, and a **second estate** the caller does not belong to holding one fully
  eligible row — that is what turns "the sweep stayed inside the estate" from an accident of an empty
  neighbour into a tested rule. Seeded shape, printed by the seed itself: 72 lane rows / 67 active /
  4 archived / 63 unread / 2 pinned.
- The BFF estate is created in SQL because the BFF never accepts an estate id from a caller — no request
  could create the estate the lane needs to be *in*. The Go lane creates its estate over HTTP, which is why
  the Go lane needs `02-grant-reviewer.sql` (the `estate.admin.lifecycle` permission) and publishes it through
  the review queue; the BFF lane moves its fixture's status in SQL and says so.

## What was executed

```
bash 01-signin.sh . /tmp/estate-uat-live          # identities + membership census
bash 03b-reapply-migration.sh                     # promoted migration re-applied  → migration-reapply-*.out
bash 05-run-server.sh &                           # Go lane server :8095
bash 06-probe-notifications.sh                    # → probe-notifications-phase2.5a.out      204 / 0
bash 10-run-livedb-suite.sh                       # → livedb-notifications-phase2.5a.out     10 / 0 / 0
psql -f - < 07-seed-notifications-bff.sql         # fixtures at a fresh stamp
bash 08b-run-web.sh                               # resolves BASE, then runs 08 → 327 / 0
psql -f - < 09-teardown.sql                       # → teardown-phase2.5a.out
```

Both probe transcripts end with a **counter self-check**: the script's own PASS/FAIL tally must equal the
number of `PASS`/`FAIL` lines in the file, and a mismatch is reported as `COUNTER DRIFT` and counted as a
failure — so a transcript cannot silently lose assertions.

## What the live HTTP surface actually enforces

The two surfaces enforce the same *rules*; each transcript line is the evidence, this is the shape.

**Inbox.** Three views (`state=active|archived|all`, default active), `unread_only`, an exact `category` from
the nine-value domain, `q` of at least 2 characters that may not contain `,` `(` `)`, `limit` 1..200 default 50,
a negative offset read as 0. `total` is the size of the whole matching set, not the page — the number the old
flat 100-row answer could not give. Order is `pinned DESC, created_at DESC`, and that ordering holds past the
first page: an offset never displaces a pinned notice. Reading past the end is an **empty page carrying the
real total**, not an error. Search reaches the body, not only the title (proved by a fixture whose title does
not contain the term).

**Read / archive / pin.** `read_at` is written once and never moved — re-reading an already-read notice is a
200 that leaves the original instant. Archiving stamps `archived_at`, keeps `deep_link`/`read_at`/`category`
intact, and is reversible to NULL. `read-all` stops at the edge of the archive: it stamps the active half and
leaves the archived unread row unread, and it is per recipient, not per estate. Pinning is a personal flag;
pinning **somebody else's** row is an estate-admin action (with or without `user_id`), and "not yours" answers
the same 404 as "not here" so a probe cannot enumerate inboxes. A member naming a stranger is 403; a member
naming *themselves* on another recipient's row is the same owner-scoped 404 — matching Go's
`SetNotificationPinned`, which folds an empty and a self target into "act for yourself" and falls through to
the same own-row check.

**Retention plane.** Estate-admin only (a member's read/write/run all 403 with the role as the reason).
GET is open on a non-active estate because it is a read; PUT and POST /run are writes and 423 while the estate
is not active. PATCH semantics: an unsent field keeps its stored value, `keep_categories` **replaces** rather
than merges, duplicates fold, `purge_after_days: 0` on the wire means NULL (never purge), and a policy naming
an invented category or a purge before the archive horizon is a 400 whose message states the rule. Every
accepted write audits `NOTIFICATION_RETENTION_SET` under `subject_type='estate'`; the four rejected writes in
the transcript audit nothing — and the baseline for that assertion is sampled immediately before the rejects,
because the accepted writes above it otherwise read as unexplained growth.

**The sweep.** Archives only what is eligible at its own instant (read, unpinned, outside `keep_categories`,
past `archive_after_days`) and reports `notifications_archived` / `notifications_purged`; it is idempotent, so
a second press moves 0. Purge happens **only** when the policy opted in. The database guard, not the API,
enforces the exceptions: a pinned row, a protected category and a held estate all refuse a `DELETE` — proven
from both directions, including a hand-run `DELETE` that succeeds against a plain archived row, which is what
makes "refused" evidence rather than an artifact of a blanket block. Legal hold returns
`skipped: 'legal_hold'` with 0/0: it declines the **whole** sweep, so an archive-eligible row stays unarchived
while the estate is held (the lane puts one there deliberately rather than leaning on a boundary row crossing
the horizon mid-run). The sweep never reaches a second estate, from either direction, and an estate that never
wrote a policy reads back the documented defaults flagged `defaulted: true` — and the sweep then applies the
90-day default instead of archiving nothing.

**Lifecycle.** Suspended or closed: the inbox, the badge and the schedule **stay readable** (the history is
retained, not erased) and every write — read stamp, archive, pin, read-all, schedule write, sweep — answers
423 naming the status. No row moves and nothing is deleted on the way. Closure leaves the policy row in place
for the audit trail.

**Identity.** `estate_notifications_apply_retention` is not callable without a service identity: PostgREST
does not route an anonymous EXECUTE, and the attempt archived nothing.

## Where the two surfaces deliberately differ

Recorded here so a later reader treats them as decisions, not drift:

| | Go `/api/finance/estate/:id/**` | BFF `/api/v1/estate/**` |
|---|---|---|
| which estate | from the path, then `LifecycleGate` | from the caller's membership; a path/query estate id is **inert** (asserted, not assumed) |
| transport | pgx against Postgres | service-role PostgREST; the sweep runs through RPC |
| item shape | snake_case, `kind` | camelCase `category`/`deepLink`/`readAt`/`archivedAt`/`pinned` — the app's pre-existing contract |
| envelope | `{data,total,limit,offset,state,unread_only}` | same keys, so one client can page either surface; retention documents stay snake_case |
| non-member on someone's row | row-scoped 404 | 403 "Not a resident of any estate" **before** the row is looked up (documented divergence, asserted on both) |
| badge for a non-resident | 404 | 200 `{count:0}` — the app draws it before it knows whether the user lives in an estate |
| paging past the end | SQL `OFFSET` → empty page + real `COUNT` | PostgREST refuses the range (`PGRST103`/416) with **no count**; the BFF now converts that to the same empty page + real total (see ESTD-D036) |

## Defects this lane found and fixed

- **ESTD-D008 / EST-UAT-0359** — closed. The archive/retention schema is promoted and both surfaces enforce
  archive, search, pin, retention policy, sweep, purge opt-in, guard and lifecycle end to end.
- **ESTD-D025, BFF half** — the retention write routes reached `requireAdminContext()` without
  `{ forWrite: true }`, so a *pending* estate answered `PUT /retention` **200** and `POST /retention/run`
  actually moved rows while every personal write correctly 423'd. `requireAdminContext`/`requireInboxContext`
  now accept and forward `ResidentContextOptions`, both write routes pass `{ forWrite: true }`, the read stays
  open on purpose, and a unit spec pins the trio (read 200 / write 423 / run 423, no upsert, no RPC, no audit).
- **ESTD-D036 (new, found by this lane)** — `GET /api/v1/estate/notifications?offset=900&limit=10` returned
  **HTTP 500** `{"success":false,"error":"Failed to list notifications"}` instead of an empty page. Reproduced
  against PostgREST directly: an offset past the last matching row answers `416` with
  `{"code":"PGRST103","details":"An offset of 900 was requested, but there are only 59 rows."}` and **no**
  `Content-Range` count is parsed on that path, so `if (error) throw error` turned a normal client behaviour
  into a server error — while the Go surface, which pages with SQL `OFFSET`, answers an empty page beside a
  real `COUNT`. `listInbox()` now treats `PGRST103` as an empty page and re-reads the size with a head request
  over the identical filters (the same count-then-page shape Go has), and every *other* PostgREST error still
  propagates — a missing relation is not called an empty inbox. Two unit specs cover both halves; the live BFF
  transcript line reads `PASS want=200 got=200 [reading past the end is a page, not an error]` with
  `total 67` still stating the real size.
- Harness faults found and corrected in this lane's own scripts, recorded because they were the difference
  between a false 100-failure run and a real one: shared multi-membership identities (now lane-owned and
  preflighted), asserting against whichever document happened to be in `resp-bff.json` (the archived-page
  assertions now read a saved copy), a fixture whose title contained the body-search term, an expectation that
  the guard's "allowed" DELETE output equal the row id when `psql -Atc` also prints the `DELETE 1` command tag,
  a read-all count expectation off by one, an audit baseline sampled too early, and a legal-hold assertion
  that leaned on a bulk fixture crossing the horizon on its own (now a deliberately aged row).

## State left behind

- The teardown ran after the green probe. `09-teardown.sql` is name-scoped (`UAT Inbox%`) and reports
  `notifications_left=0 policies_left=0 memberships_left=0 estates_still_open=0`, with **75** retention audit
  rows kept — the audit trail and the lane estates as `closed` records are deliberately *not* deleted, matching
  the Phase 2.3/2.4 lanes. It also had to un-pin, move a protected category and lift legal hold before it
  could clear its own fixtures, which is the guard working.
- `estate-uat-inbox-{res,admin,none}@local.test` keep their `auth.users`/`platform_users` rows and hold **0**
  memberships. The lifecycle grant is removed again (`lifecycle_granted_after_teardown = f`).
- Other sessions' data was not touched: `'UAT Gate Estate Alpha'` and every non-`UAT Inbox%` estate are
  outside the teardown's match, and the `:3001`/`:8091`/`:8093`/`:8094` servers were left running.
- Code state, split by what a reviewer can pull versus what only exists here:
  - **In history, but not as an estate commit.** `git log --diff-filter=A` shows
    `supabase/migrations/20271099000070_estate_notifications_archive.sql`,
    `backend/internal/estate/notifications_retention.go`, `notifications_retention_handler.go`,
    `notifications_retention_live_db_test.go` and the BFF `[id]/archive` route all **added** by `93d750a40`
    (`feat(crypto): CR-012 test suite — swap execution with quotation confirmation`) — another session's
    commit that swept the estate surface in with it. The BFF inbox list route is older still (added by
    `5526a8bc1`, last touched by the same `93d750a40`), and the two retention routes were added by
    `134e38499`, also a crypto commit. So the schema and the Go surface ship to anyone who pulls, and none
    of it is citable, bisectable or revertible as estate work.
  - **Uncommitted** (four files, because committing was not asked for):
    `frontend-web/src/server/estate/notifications.ts` (the `forWrite` plumbing and the `PGRST103` paging
    fix), `app/api/v1/estate/notifications/retention/route.ts` and `…/retention/run/route.ts` (both writes
    now pass `{ forWrite: true }`), and `tests/unit/estate/notification-inbox.spec.ts`. That is ESTD-D025's
    BFF half and all of ESTD-D036.
  - `resident.ts` needed no change: its `ResidentContextOptions.forWrite` gate has existed since the Phase
    2.3 mirror (`fc6fd64f7`); what was missing was the retention routes ever using it.
  - Re-verified at ledger time: `npx vitest run tests/unit/estate` = 14 files / **180 tests** green and
    `npx tsc --noEmit` clean.
- Ledger effects in `docs/qa/estate-uat-443/`: `rtm-estate-d.csv` EST-UAT-0359 `PARTIAL`/`NEEDS_MANUAL` →
  `IMPLEMENTED`/`PASSED` (defect ids now `ESTD-D008|ESTD-D036`); `defects-estate-d.csv` ESTD-D008 →
  `FIXED`, ESTD-D025 `actual` extended, ESTD-D036 appended (36 rows); `exec-estate-d.csv` EXEC-D-022 …
  EXEC-D-026 appended; `cluster-estate-d.md` M18 12 PASSED / 0 NEEDS_MANUAL with a Phase 2.5a section;
  `SUMMARY.md` counts and the pending-schema section; and
  `migrations-estate-d/estate_notifications_archive.pending.sql` retired to a pointer note whose original
  statements are commented out, so nothing there can be fed to a migration runner by accident.
  `closeout-triage.csv` is left as the Phase 0 snapshot it is (same as Phases 2.3/2.4 did) — Phase 8
  reconciles it.
- Most of this directory is still **untracked**: `01-signin.sh`, `02-grant-reviewer.sql`,
  `03-schema-notifications.sql`, `04-seed-notifications.sql` and `05-run-server.sh` are in history (via the
  same `93d750a40`), while `03b`, `06`, `07`, `08`, `08b`, `09`, `10`, this README and all six `.out`
  transcripts are not. `.gitignore` excludes `*.log`, which is why this lane's evidence is `.out` — it is
  the difference between a transcript that survives a clone and one that does not.

## Boundaries of this evidence (read before re-marking anything)

- This is a **local-stack** lane: local Supabase, feature flags forced on for the lane server, fixtures
  created by scripts in this directory. Nothing here speaks to staging or production, and the eight estate
  flags still default to `false` in committed config — the flag-on/flag-off HTTP comparison Phase 2 still owes
  is a separate lane.
- The transcripts prove **HTTP behaviour and database state at the stamps shown**. They do not prove device
  behaviour: EST-UAT-0359's mobile screen (list rows, pull-to-refresh, deep link) is still a manual/device
  pass, and the M21 rows about screen readers, contrast and background delivery stay `NEEDS_MANUAL` for the
  same reason. The app's own paging is unchanged by this lane; what changed is that the surface it calls can
  now say how big the inbox is, can archive/pin/search it, and cannot be paged into a 500.
- Push/SMS delivery, invalid-device-token handling and provider retries (EST-UAT-0356, 0363, 0364) are
  platform-owned and remain `BLOCKED`; this lane touches only the in-app inbox rows those handlers write.
- `notifications_archived` from a held estate is 0 whether or not anything was eligible, because the function
  returns early with `skipped:'legal_hold'` and **neither surface forwards that reason** to its caller — so a
  console cannot tell "held" from "nothing to do" without reading the estate. Recorded as a known limitation
  rather than fixed here, because adding the field to one surface would itself be the drift this lane exists
  to prevent; it needs a decision that covers Go and BFF together.
- Timing-sensitive assertions sample the database *immediately* before the request they describe. The bulk
  fixtures are one minute apart and straddle the 2-day horizon the lane sets, so anything measured against an
  older sample is a clock artifact, not a product fact — that distinction cost this lane one real-looking
  failure and is why the hold case ages its own row instead of waiting for a boundary.
