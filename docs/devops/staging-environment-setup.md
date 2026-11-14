# Staging environment — setup runbook

## Decided topology

The Supabase org `spotlight` (`wqawduvaaclevmuhgzhy`) is on the **free** plan,
which allows 2 active projects. Rather than upgrade to Pro for a third, the
existing `spotlight` project was **re-purposed as staging** and renamed, so the
two slots now map cleanly onto the two environments:

| Role | Project | Ref | Region | Migrations applied |
|---|---|---|---|---|
| **Staging** | `spotlight-staging` | `wnicsubiznmishkmunsv` | eu-west-1 (Ireland) | 420 |
| **Production** | `spotlight-prod` | `nmseefdlliejmdbxytej` | eu-north-1 (Stockholm) | 418 |

Local `supabase/migrations/` holds **429** files, so staging is 9 behind and
production is 11 behind. The `db-migrate.yml` jobs below close both gaps.

### Why this was safe

The swap was verified against live data before it was made — **neither database
held any production data**:

| | users | profiles | ledger_entries | orders |
|---|---|---|---|---|
| `spotlight-staging` | 6 | 6 | 0 | 0 |
| `spotlight-prod` | 1 | 1 | 0 | 0 |

Zero ledger entries and zero orders on both sides means no money had ever moved
through either database, so re-labelling one of them cost nothing. **This
reasoning expires the moment real users transact.** After that, re-pointing an
environment is a data migration, not a rename — re-run those counts before ever
doing this again.

### Consequence to be aware of

The root `.env` points at `wnicsubiznmishkmunsv`, which is now **staging**. That
is the intended outcome of this choice — local development and staging share one
database. There is no longer a separate dev database; treat staging data as
shared and disposable. (That `.env` also still carries a reference to the retired
project `ptczqwfokydsdafpscex` — unrelated leftover, safe to delete.)

## Creating a project (only if a third environment is ever added)

Requires a Pro upgrade (~$25/mo) — the free plan is at its 2-project limit.

```bash
supabase projects create spotlight-<env> \
  --org-id wqawduvaaclevmuhgzhy \
  --region eu-west-1 \
  --db-password "$(openssl rand -base64 32)"
```

Capture that password — it is shown once. Do not commit it, and do not paste it
into a terminal that is being transcribed.

## Wiring (already committed — no action needed in the repo)

`.github/workflows/db-migrate.yml` now carries **two** apply jobs rather than two
workflows, so a push still costs a single workflow run:

- `apply` → production, on push to `main`, gated `DB_MIGRATE_ENABLED == 'true'`
- `apply-staging` → staging, on push to `staging`, gated
  `DB_MIGRATE_STAGING_ENABLED == 'true'`

Each job selects itself by branch, so a push to `main` cannot reach the staging
database and a push to `staging` cannot reach production. `apply-staging` also
hard-fails if its project ref equals the production ref, which is the realistic
way a copy-pasted secret ends up applying to the wrong database.

Both jobs pin the Supabase CLI to the **same** version on purpose: if they could
disagree about how a migration applies, a chain that went green on staging would
prove nothing about production. Bump the two pins together.

`workflow_dispatch` takes a `target` (staging | production) and defaults to a
dry run, so credentials can be verified before anything is applied.

## Remaining manual steps

**Status re-read 2026-11-14 against the live repo, not against memory.** A step
below is checked only where a command returned the proof; every unchecked step
carries the reason it is still open. The full evidence trail is
[`production-migration-ledger.md`](production-migration-ledger.md) §16.

- [ ] **Step 1 — not verified, and not verifiable from a review session.**
- [x] **Step 2 — the `staging` environment exists** (proof below); its three
      secrets exist **at repo level**, not environment-scoped.
- [x] **Step 3 — both variables are on** (proof below). Note this makes step 1's
      unresolved ref an *active* risk, not a dormant one.
- [x] **Step 4 — staging is at 0 pending**, re-measured by Task 5 (ledger §5.4),
      superseding the 2026-08-21 figures in that section's own text.
- [ ] **Step 5 — still open, and now mis-framed:** the `staging` *branch* matters
      less than the note below assumes, because frontend-web is no longer
      deployed from it at all (see the policy note).

### Policy correction: "deploy only to main, never staging"

Verified from `.github/workflows/` on 2026-11-14, so this section's branch
advice has to be read against it:

- `b5bc4480f` — "ci(frontend-web): retire the staging-branch deploy lane" —
  deleted `.github/workflows/staging-frontend-web-deploy.yml`. That file is not
  in `.github/workflows/` today (only `staging-admin-signup-code.yml`,
  `staging-bills-e2e.yml`, `staging-inspect.yml`, `staging-module-flags.yml`
  remain), and the commit is an ancestor of this branch's `HEAD`.
- `sync-frontend-web.yml:5-11` triggers on `main` and `development` only — the
  `staging` branch is in neither the branch list nor the path list.
- Consequence: **frontend-web has no staging-branch deploy path.** Pushing the
  `staging` branch releases nothing on that rail; Railway's staging services
  track `main` (see `deployment-matrix.md`, "Promotion model").
- What the `staging` branch *does* still drive: `db-migrate.yml:40` includes
  `staging` in its push branches, and its `apply-staging` job (`:183-187`) fires
  on a push to `refs/heads/staging` while
  `vars.DB_MIGRATE_STAGING_ENABLED == 'true'`. That switch is on today (step 3),
  so **a push to the `staging` branch is a live database write lane**, which is a
  stronger reason to keep that branch honest than the UI-parity argument this
  section originally gave.

### 1. Re-point the PRODUCTION secret first — before anything else

**STILL OPEN — unverified, and not closable from a read-only session.** The
value of `SUPABASE_PROJECT_ID` cannot be read: `gh api
repos/paymax2022/spotlight-latest1/environments/Production/secrets` returns only
the *name* `SUPABASE_DB_PASSWORD` (no environment-scoped `SUPABASE_PROJECT_ID`,
so the ref comes from the repo-level secret of that name), and Actions secrets
are write-only by design. What is settled: `ops-db-push-scoped.yml:101-104`
refuses `wnicsubiznmishkmunsv` under `environment: production-db-scoped`, and
that lane's completed runs prove only **that** environment's ref, not
`Production`'s. The only thing that answers the question is a dispatched
`ops-db-push.yml` **link-step log** (`ops-db-push.yml:128-129` runs
`supabase link --project-ref "$SUPABASE_PROJECT_ID"`), i.e. an operator action
this plan was not authorised to take — recorded as operator-owned in ledger §16.

`SUPABASE_PROJECT_ID` was set when `wnicsubiznmishkmunsv` was the only project,
so it most likely still points at it — and that project **is now staging**. Left
as-is, a push to `main` would apply *production* migrations to the *staging*
database while production received nothing.

Check and correct it before enabling either job:

- `SUPABASE_PROJECT_ID` (environment `production`) must be
  **`nmseefdlliejmdbxytej`**
- `SUPABASE_DB_PASSWORD` must be the **`spotlight-prod`** password, not the old
  one — these two must be changed together or the link will simply fail.

The `apply-staging` job refuses to run when its ref equals `SUPABASE_PROJECT_ID`
(the comparison is `db-migrate.yml:263-266`, staging secret vs production secret),
so if the production secret is still the old value, staging fails loudly rather
than pushing to the wrong database. That guard is a backstop, not a substitute
for fixing the secret.

### 2. Create the `staging` GitHub environment

**DONE — verified again 2026-11-14.**
`gh api repos/paymax2022/spotlight-latest1/environments --jq '.environments[].name'`
lists `staging`. Read the whole list before you script against it — there are
**10** environments and several names carry a Railway deployment prefix, so a
lookup on the bare string misses: `staging`, `development`, `Production`,
`production-db-scoped`, `Preview`, `spotlight-platform / staging`,
`spotlight-platform / staging-new`, `spotlight-platform / staging-Old`,
`enchanting-flexibility / production`, `jubilant-emotion / production`. There is
no bare `staging-new` or `staging-Old`.

The three secrets below exist **as repository-level secrets**, not
environment-scoped ones: `gh api …/environments/staging/secrets` returns
**nothing**, while `gh api …/actions/secrets` lists
`SUPABASE_STAGING_PROJECT_ID`, `SUPABASE_STAGING_DB_PASSWORD` and
`SUPABASE_ACCESS_TOKEN` by name. That is a working configuration, but it means
the staging jobs read repo-wide values, so a per-environment rotation would not
be honoured — worth knowing before anyone "fixes" it by adding a second copy.
Values were never printed and cannot be, so **none of the three mappings is
verified** — only their existence.

Settings → Environments → New environment → `staging`, then add:

- `SUPABASE_STAGING_PROJECT_ID` = `wnicsubiznmishkmunsv`
- `SUPABASE_STAGING_DB_PASSWORD` = the `spotlight-staging` database password
- `SUPABASE_ACCESS_TOKEN` = the account token (same value as production; it is
  an account token, not per-project)

Note: the `spotlight-staging` database password is known to be **stale** — the
CLI and Management API work against it, but direct `psql`/pgx connections fail
with `28P01`. Reset it in Dashboard → Settings → Database before adding the
secret, or `db push` will fail at the link step.
**This note was not re-tested in this plan**, and it is the reason no
`pg_dump`-or-restore step could be rehearsed from a review session — see
[`backup-restore-runbook.md`](backup-restore-runbook.md) §2 and ledger §5.7.

### 3. Enable the jobs

**DONE — verified 2026-11-14.**
`gh api repos/paymax2022/spotlight-latest1/actions/variables` returns exactly
`DB_MIGRATE_ENABLED=true` and `DB_MIGRATE_STAGING_ENABLED=true` (plus
`RAILWAY_DEPLOY_ENABLED=true`, `SPOTLIGHT_FRONTEND_SYNC_ENABLED=True`).

Add repo **variables**:

- `DB_MIGRATE_STAGING_ENABLED = true`
- `DB_MIGRATE_ENABLED = true` (only once step 1 is confirmed correct)

**Read the two facts together, because they contradict in an alarming
direction:** step 3 is done and step 1 is unverified. The switches were enabled
without proof that `SUPABASE_PROJECT_ID` left the staging ref behind, so
`db-migrate.yml`'s push lane on `main` is armed today and its only protection is
the equality backstop above plus the `Production` environment's **required
reviewers** — measured 2026-11-14: both parked runs return
`pending_deployments[].reviewers` = two `User` entries with `wait_timer: 0`, and
`current_user_can_approve: false` for a non-reviewer. That
is why ledger §16 counts two production writes parked on approval right now —
`deployment-matrix.md` and this file no longer restate their run ids, heads or
timestamps: ledger §16.2 item 1 owns them, because a third copy of a live run
state is a third way to be stale. This plan approved, declined and dispatched
none of them.

### 4. Dry-run, then apply — ALREADY DONE for staging (2026-08-21)

**STILL DONE — but the figures in this section's body are superseded, not
confirmed by it.** The 420 / 418 / 429 numbers in the *Decided topology* table at
the top of this file, and the
"429 applied / 429 local / 0 pending / 0 remote-only drift" line below are
2026-08-21 readings against a 429-file tree. The tree today holds **751**
`supabase/migrations/*.sql` files (`ls supabase/migrations/*.sql | wc -l`), and
`origin/main`'s tree holds **755** — re-read 2026-11-14 at its tip `31505cb92`.
It held 754 when the figures below were written; the 754→755 step is `8ed8123de`
(2026-11-14), which added
`supabase/migrations/20271411000000_reconcile_doctors_presence_backfill.sql`.
**Every other 754 in this plan stays correct as written** — the `recorded: 754`
at the end of this paragraph (ledger §5.4) and the `754 − 670 = 84` closures
(ledger §1.4 and §2.5) — because those are pinned to `3654f6b3f` / `623c7c128`,
both of which count 754. Do not sweep-replace; but do not read §5.4's
"`origin/main`'s tree (754 files)" as a standing property either — it is a
2026-11-13 capture and now carries its own annotation.
Staging's current state comes from Task 5, not
from this section: **0 pending**, `recorded: 754`, `remote max applied:
20271410000000`, read from the write run's own before/after captures
(ledger §5.4) — with the *empty schema diff* half of the runbook's gate still
**unmeasured** (ledger §5.7). Production is **not** "11 migrations behind", and
the "was NOT touched" sentence below is now false as a live claim: §5.2's fresh
classification gave **88 pending** (a count that rides on a 2026-11-07 capture,
so re-read it rather than quoting it — §5.6), while prod's history table had
already gained `20271408000000` and `20271409000000` through
`ops-db-push-scoped.yml` — a production write that needed no reviewer, executed
by another session outside this plan's ordering (ledger §1.4, §5.5).

Staging's 9 pending migrations were applied out-of-band via the Supabase
**Management API** (`POST /v1/projects/{ref}/database/query`), not `db push`,
because that path needs no database password and the staging password was stale.
Result verified afterwards: **429 applied / 429 local / 0 pending / 0
remote-only drift**, `user_module_grants` and `restaurant_staff` present, the
widened `platform_module_environments_status_check` accepting `coming_soon`, and
RLS enabled on all five affected tables.

Each file was sent WHOLE rather than split on semicolons —
`20261215000000_module_coming_soon_status.sql` wraps its constraint swap in a
`DO $$ … $$` block whose body contains semicolons, so naive splitting would
corrupt it. Each request also inserted its own `schema_migrations` row, so a
later `db push` sees the chain as applied and skips it.

Production (`spotlight-prod`) **as of this 2026-08-21 capture** was **11 migrations
behind** and NOT touched — that sentence is no longer a live state; read the block
immediately below before acting on it.

> **THIS SENTENCE IS FALSE — left in place only as the 2026-08-21 record, and it
> is the exact claim §5.2 and §16.2 item 2 exist to retire.** Both halves are
> wrong now: "11 behind" was superseded by §5.2's fresh classification of
> **88 pending** (a 2026-11-07 capture, so re-read rather than quote — §5.6),
> and "was NOT touched" stopped being true on 2026-11-12 evening, when §1.4
> recorded prod gaining `20271408000000` and `20271409000000` and then
> `20271410000000` — all three through `ops-db-push-scoped.yml`, **the lane that
> needs no reviewer**, in two `mode=apply` runs whose ids and timestamps §1.4 and
> §16.2 item 1 hold; this file no longer repeats them, because a live run id
> copied into a fourth document is a fourth way to be stale. None of the three
> was dispatched by this plan. Those runs' post-apply reads
> left prod at **84** pending against the `3654f6b3f` tree, so production's
> pending count is *not* a figure to quote and is Task 6's first command.

For future applies, prefer the workflow: Actions → *DB Migrate* → Run workflow →
choose `target`, dry run **checked** first, then re-run unchecked. Two
preconditions this 2026-08 text predates: the run parks on the `Production`
environment's required reviewers until a named human approves (ledger §16.2 item
1), and a pre-cutover prod dump must exist first (item 3) — neither is true yet.

### 5. Promote the branch

**STILL OPEN, and the sentence below is stale in both directions.** Re-measured
2026-11-14 against the fetched refs (`git rev-list --count`). **Pin the refs when
you re-run this — the numbers move every time `main` takes a merge, and this one
moved while the sentence was being written.** Read at
`origin/main` = `31505cb92`, `origin/staging` = `623c7c128`,
`origin/develop` = `da665dcd0`; a re-fetch ~3h later, at `origin/main` =
`7a97609d0` (22:13 +0100), read **22 / 5 / 1630** for the same three pairs — the
table below is the pinned first capture, not a live state, and the shape (main
pulling away from both) is the actual finding. The migration-file count did **not**
move with it: `git ls-tree -r --name-only origin/main -- supabase/migrations`
counts **755** at both tips.

| Pair | Commits |
|---|---|
| `origin/staging` behind `origin/main` | **19** |
| `origin/staging` ahead of `origin/main` | **4** |
| `origin/main` ahead of `origin/develop` | **1627** |

An earlier capture of the same command, hours before, read **18 / 4 / 1626** at
`origin/main` = `fc705d58d`; both are correct at their own ref and neither is
portable.

So `staging` is neither "53 commits behind `develop`" nor meaningfully behind
`main`: it is 4 commits **ahead** of `main` (its tip is `623c7c128`, which is
also the commit the live staging Go binary reports —
`https://backend-staging-new.up.railway.app/api/v1/public/build` →
`{"commit":"623c7c128…","started_at":"2026-11-13T00:55:09Z"}`), and `develop` is
the branch that has fallen out of use. "Bring `staging` forward from `develop`"
would move it backwards.

What is actually owed here is a decision, not a merge: those 4 staging-only
commits need to land on `main` (or be dropped), and because `db-migrate.yml:40`
still triggers `apply-staging` on a push to `staging`, the branch is a live DB
writer even though its deploy lane is retired. This plan changed no branch.

## Mobile: no mock data on staging

Every `EXPO_PUBLIC_*_USE_MOCK` flag defaults to **mock when absent**, so an
incomplete env does not fail — it quietly serves fixtures.

```bash
cd mobile-app/reactnative
cp .env.staging.example .env.staging   # then fill the CHANGE_ME values
npm run check:env-mocks:staging        # must exit 0 before building
```

The gate derives its flag list by scanning `src/` and `app/`, so a new module's
flag is enforced as soon as it is referenced in code.

Build with the `staging` EAS profile (`eas.json`), which did not exist before —
the `preview` profile carried no env at all, so a staging build shipped with
every mock switched on.

### Backend mock providers

These default to `mock` and must be set in the staging backend environment:

| Variable | Default |
|---|---|
| `CRYPTO_PROVIDER` | `mock` |
| `TRIAGE_ENGINE` | `mock` |
| `MAPS_PROVIDER` | `mock` |

## Paystack: staging MUST use test keys

Staging is meant to mirror production except for money movement — it must
never be able to move real funds. That means the staging Railway backend
service's `PAYSTACK_SECRET_KEY` has to be a `sk_test_…` key (not `sk_live_…`),
and the staging mobile build's `EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY` (`eas.json`
`staging` profile) has to be the matching `pk_test_…` key from the *same*
Paystack test-mode dashboard. `internal/config/validate.go` rejects a key in
the wrong shape (`pk_` where a secret is expected, etc.) but does NOT know
which environment it is running in, so it cannot catch a live key deployed to
staging — that check has to happen by reading the Railway staging service's
actual env vars, which this session did not have access to do.

There have been two known bugs in this area, both fixed 2026-09-25:
- The mobile app's `Linking.openURL(authorization_url)` fallback flow depended
  on the backend's Paystack `callback_url` — which every mobile call site sent
  as an empty string — landing somewhere real after checkout. With no
  `callback_url`, Paystack falls back to the **default callback URL configured
  in the Paystack account dashboard**, which was apparently set once during
  local testing and left pointing at `http://0.0.0.0:8080/api/v1/...` (a
  server bind address, meaningless off that machine). Users saw that raw URL
  in the external browser after a successful card payment. Fixed in PR #224 by
  flipping `useGatewayCheckout.ts`'s `SDK_CHECKOUT_ENABLED` gate to default ON
  (`EXPO_PUBLIC_SDK_CHECKOUT !== 'false'`, opt-out instead of opt-in) so card
  checkout runs inside the in-app Paystack WebView SDK instead — success/cancel
  come back via `postMessage`, so the flow no longer depends on `callback_url`
  or an external browser redirect at all, and no build profile needs to
  remember to set the flag. `EXPO_PUBLIC_SDK_CHECKOUT` itself was later removed
  entirely (PR #227): the in-app SDK is now the ONLY checkout path, with no
  opt-out flag and no `onFallback`/`Linking.openURL` escape hatch anywhere in
  the payments code. **Still needs a manual follow-up**: update the default
  callback URL in the Paystack dashboard (for both the test and live API key
  pairs) away from `0.0.0.0:8080` — belt-and-suspenders, since nothing in the
  app depends on it reaching anywhere real anymore, but a future screen built
  against the raw `initiateXPaystack` → redirect pattern (bypassing
  `useGatewayCheckout`) could still hit it.
- `app/profile/business/register/index.tsx`'s registration-fee flow — the one
  screen not migrated when PR #224 fixed the other seven — was migrated to
  `useGatewayCheckout` in PR #227. The old two-step "open browser, come back,
  tap verify" UI is gone; payment success now completes automatically via
  `onResolved`, same as every other Paystack-funded flow.

## Not covered here

- Cloud Run staging deploys in `deploy.yml` are gated on `vars.GCP_PROJECT_ID`,
  which is unset, so those jobs skip entirely. Railway (branch → environment) is
  the live deploy path.
- `integration-verify` does not run on pushes to `develop`, which is how both a
  mobile typecheck break and an RLS gap previously reached the branch unnoticed.
