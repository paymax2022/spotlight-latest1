# Staging environment — setup runbook

Status: **blocked on one paid decision.** Everything that does not cost money is
already wired and committed; the steps below are what remains.

## The blocker

The Supabase organisation `spotlight` (`wqawduvaaclevmuhgzhy`) is on the **free**
plan, which allows **2 active projects**, and both slots are in use:

| Project | Ref | Region | Migrations applied |
|---|---|---|---|
| `spotlight-prod` | `nmseefdlliejmdbxytej` | eu-north-1 | 418 |
| `spotlight` | `wnicsubiznmishkmunsv` | eu-west-1 | 420 |

Local `supabase/migrations/` holds **429** files, so *both* remotes are behind.
Neither is a spare: both are `ACTIVE_HEALTHY` and carry a near-complete chain.

A third project therefore requires upgrading the org to **Pro (~$25/month)**.
That is a purchase, so it is not something automation should do on its own —
it needs an explicit human decision.

### Options

1. **Upgrade to Pro and create a third project** — the clean split
   (dev / staging / production). Also unlocks Supabase Branching, PITR and
   larger compute. Recommended if staging is going to be permanent.
2. **Re-purpose `spotlight` as staging** and treat `spotlight-prod` as the only
   production database. Free, but it removes the shared dev database — local
   `.env` currently points at `spotlight`, so every developer would then be
   pointing at staging.
3. **Stay on two projects** and accept that "staging" is just the `develop`
   deploy against `spotlight`. Free, but it is not an isolated environment and
   staging tests would share data with dev.

## Creating the project (after the plan decision)

```bash
supabase projects create spotlight-staging \
  --org-id wqawduvaaclevmuhgzhy \
  --region eu-west-1 \
  --db-password "$(openssl rand -base64 32)"
```

Capture that password — it is shown once and is needed as a secret below. Do not
commit it, and do not paste it into a terminal that is being transcribed.

Region `eu-west-1` matches `spotlight`; use `eu-north-1` to match production
latency instead. Either is defensible — pick one and record it here.

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

1. Create the GitHub environment **`staging`** (Settings → Environments).
2. Add to that environment:
   - `SUPABASE_STAGING_PROJECT_ID` — the new project ref
   - `SUPABASE_STAGING_DB_PASSWORD` — the password from project creation
   - `SUPABASE_ACCESS_TOKEN` — the account token (same value as production; it
     is an account token, not per-project)
3. Add the repo **variable** `DB_MIGRATE_STAGING_ENABLED = true`.
4. Dry-run first: Actions → *DB Migrate* → Run workflow → target `staging`,
   dry run **checked**. Confirm it links and lists pending migrations.
5. Re-run with dry run unchecked to apply the chain.
6. Bring the `staging` branch up to date — it is **53 commits and 9 migrations**
   behind `develop`.

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
