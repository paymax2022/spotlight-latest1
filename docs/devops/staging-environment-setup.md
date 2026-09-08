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

### 1. Re-point the PRODUCTION secret first — before anything else

`SUPABASE_PROJECT_ID` was set when `wnicsubiznmishkmunsv` was the only project,
so it most likely still points at it — and that project **is now staging**. Left
as-is, a push to `main` would apply *production* migrations to the *staging*
database while production received nothing.

Check and correct it before enabling either job:

- `SUPABASE_PROJECT_ID` (environment `production`) must be
  **`nmseefdlliejmdbxytej`**
- `SUPABASE_DB_PASSWORD` must be the **`spotlight-prod`** password, not the old
  one — these two must be changed together or the link will simply fail.

The `apply-staging` job refuses to run when its ref equals `SUPABASE_PROJECT_ID`,
so if the production secret is still the old value, staging fails loudly rather
than pushing to the wrong database. That guard is a backstop, not a substitute
for fixing the secret.

### 2. Create the `staging` GitHub environment

Settings → Environments → New environment → `staging`, then add:

- `SUPABASE_STAGING_PROJECT_ID` = `wnicsubiznmishkmunsv`
- `SUPABASE_STAGING_DB_PASSWORD` = the `spotlight-staging` database password
- `SUPABASE_ACCESS_TOKEN` = the account token (same value as production; it is
  an account token, not per-project)

Note: the `spotlight-staging` database password is known to be **stale** — the
CLI and Management API work against it, but direct `psql`/pgx connections fail
with `28P01`. Reset it in Dashboard → Settings → Database before adding the
secret, or `db push` will fail at the link step.

### 3. Enable the jobs

Add repo **variables**:

- `DB_MIGRATE_STAGING_ENABLED = true`
- `DB_MIGRATE_ENABLED = true` (only once step 1 is confirmed correct)

### 4. Dry-run, then apply — ALREADY DONE for staging (2026-08-21)

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

Production (`spotlight-prod`) is still **11 migrations behind** and was NOT
touched. Apply it through the normal gated job once its secrets are correct.

For future applies, prefer the workflow: Actions → *DB Migrate* → Run workflow →
choose `target`, dry run **checked** first, then re-run unchecked.

### 5. Promote the branch

`staging` is **53 commits and 9 migrations** behind `develop`, so it cannot
exercise anything current until it is brought forward.

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

## Not covered here

- Cloud Run staging deploys in `deploy.yml` are gated on `vars.GCP_PROJECT_ID`,
  which is unset, so those jobs skip entirely. Railway (branch → environment) is
  the live deploy path.
- `integration-verify` does not run on pushes to `develop`, which is how both a
  mobile typecheck break and an RLS gap previously reached the branch unnoticed.
