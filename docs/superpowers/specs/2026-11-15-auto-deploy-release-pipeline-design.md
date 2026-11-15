# Auto-deploy release pipeline — design

**Date:** 2026-11-15
**Status:** Approved direction (reconcile-then-flip, new `release.yml` chain). Not started.
**Scope:** every push to GitHub `main` releases itself — development, staging and production — with no human approval step in the way. One new workflow owns the whole chain; `ci.yml` goes back to being CI-only. No application code changes, no schema changes.

## Goal

A commit merged to `main` reaches development, staging and production without anyone clicking approve, typing `DEPLOY`, or pushing a promotion branch. Each environment's database migration is applied by the same chain before the code that needs it, and production is never written until staging has been probed and is serving the new commit. The chain has one emergency brake (`vars.RAILWAY_DEPLOY_ENABLED`) and one rollback path (`workflow_dispatch` with a `ref`), because removing approvals removes the human who used to catch a mistake.

## Verified current state

**What already auto-deploys, and needs no change.**

- Production database migrations: `db-migrate.yml` applies on push to `main` when `vars.DB_MIGRATE_ENABLED == 'true'`, under `environment: production`. It already has a stale-ref guard ("Refuse a stale or unapproved ref") and `concurrency: db-migrate-${{ github.ref }}` with `cancel-in-progress: false`.
- Production `frontend-web`: `sync-frontend-web.yml` pushes to `paymax2022/spotlight-latest` `main`, and *that* repo's cPanel lane is ungated. `deploy-cpanel.yml` in this repo is inert — 0 successes in 843 runs, `vars.CPANEL_DEPLOY_ENABLED` unset, five secrets absent.
- `vars.RAILWAY_DEPLOY_ENABLED` is already `true`.

**What is manually gated today.**

`ci.yml` carries three deploy jobs (development, staging, production), each a `workflow_dispatch` lane that requires all five of:

```yaml
github.event_name == 'workflow_dispatch' &&
inputs.deploy_environment == '<env>' &&
inputs.confirm_deploy == 'DEPLOY' &&
github.ref == 'refs/heads/<promotion branch>' &&
vars.RAILWAY_DEPLOY_ENABLED == 'true'
```

So a release needs a dispatch, a typed confirmation, and a promotion branch (`develop` / `staging` / `prod`) that is not `main`. That is the manual step the user wants gone.

**The one approval gate that existed.** Only the `Production` GitHub Environment had required reviewers (`spec-ng`, `TheBraveByte`). Environment-name resolution is case-insensitive, so `environment: production` resolves to env `Production`. **Those reviewers were removed on 2026-11-15 (~16:34Z)** with `PUT repos/paymax2022/spotlight-latest1/environments/Production` and `{"wait_timer":0,"prevent_self_review":false,"can_admins_bypass":true,"reviewers":[]}`. Rollback is a re-PUT with reviewers `spec-ng` (id 18039055) and `TheBraveByte` (id 59900242). No other environment has reviewers.

**A parked deployment does not auto-approve when its reviewers are removed — it fails.** Run `43723411971` (`Ops DB Push`, production `supabase db push`) was parked at that gate. Removing the reviewers moved it `waiting → error` at 16:34:43Z. The jobs API shows **zero steps**, started 14:21:42Z (park time), completed 16:34:43Z (the PUT), and `gh api .../jobs/132841639588/logs` returns `BlobNotFound`. The job never reached a runner, so **no production database write occurred**. This is recorded rather than assumed because the user's chosen outcome ("let it run, then remove the gate") did not happen.

**`main` is not a superset of what production and staging serve — this is the blocking finding.** Measured live 2026-11-15 by reading each backend's own `/api/v1/public/build` (the binary is stamped via `BUILD_COMMIT` + `-ldflags`, `source: "ldflags"`), then testing each served SHA with `git merge-base --is-ancestor <sha> origin/main`:

| Environment | Served commit | Ancestor of `origin/main` (`6199a6b57`)? | Process started |
|---|---|---|---|
| production backend | `5ab7c9cc0bf3d2b42aa43215fe5df9630dfbc421` | **no** | 2026-11-15T09:00:26Z |
| staging backend | `2a82a62ef158f61e984b9b40f4a268c50e5fa299` | **no** | 2026-11-14T20:54:20Z |
| development backend | `15975f64fde9c5b86f21eeedc2ada0c05d253393` | yes (stale, not diverged) | 2026-10-16T05:43:57Z — 30 days old |

`/healthz` answers 200 on all three. `/readyz` answers 200 on production and staging but **503 on development** — its DB pool is not reachable, so a smoke step that requires `readyz == 200` in development fails today, before any of this work. That is a pre-existing condition, and it is a second reason the development leg must not gate production (Decision F).

Re-measured 2026-11-15 against `origin/main` = `6199a6b57`. `git rev-list --left-right --count origin/main...origin/prod` → `745	10`: 745 commits exist only on `main`, and **10 exist only on `origin/prod`**. For `origin/staging` → `30	5`: **5 commits exist only on `origin/staging`**. Of those, `git cherry` (which compares patch content, not SHAs) marks **6 prod-only** and **4 staging-only** commits with `+`, meaning they are genuinely absent from `main` rather than already landed in another form. Auto-deploying `main` as it stands would **roll production back** over work that only ever existed on the promotion branches.

Among the candidates, two need individual judgement rather than a blanket merge:

- `6948a6c49 ci: add gated frontend-only staging deploy` — would resurrect a lane that was deliberately deleted in `b5bc4480f` (the repo's standing policy is "deploy only to `main`, never staging"). Landing it re-creates two live writers for one service-environment pair, which `docs/devops/deployment-matrix.md` forbids.
- `41c19ea2b` — carries feature-flag defaults (VertoFX off, estate/mobile live defaults) that may contradict `main`'s current values.

**The matrix document is canonical.** `docs/devops/deployment-matrix.md` states: "When this matrix and a config file disagree, this file wins." Its reconciliation checklist requires declaring the row FIRST, one path per service per environment (never two live writers), a canary/probe contract (`/healthz` + `/readyz`), and migrations BEFORE traffic. This design follows that order.

**A working pattern to fold in.** `development-deploy.yml` already deploys **from `main`** to the Development environment (`backend`, `frontend-admin`), gated only on "commit is on `main` and has no failed checks", `concurrency: development-deploy-${{ inputs.service }}`, `cancel-in-progress: false`. It is dispatch-only; the new chain absorbs its shape and it is then retired.

**Railway service inventory, measured 2026-11-15** (project `spotlight-platform`, `e7dca861-3667-4d9a-8090-6d2f4d179ec2`). Every service has `source: null`, so no push can auto-deploy — `railway up` is the only route.

| Environment | Service | Last deployment | URL |
|---|---|---|---|
| development | `backend` | SUCCESS 2026-10-16 | `backend-development-502c.up.railway.app` |
| development | `frontend-admin` | SUCCESS 2026-10-07 | `frontend-admin-development-5a67.up.railway.app` |
| development | `frontend-web` | **FAILED 2026-11-13** | `frontend-web-development.up.railway.app` |
| development | `notification-worker` | SUCCESS 2026-11-01 | — (no URL) |
| staging | `backend` | SUCCESS 2026-11-14 | `backend-staging-new.up.railway.app` |
| staging | `frontend-admin` | SUCCESS 2026-11-15 | `frontend-admin-staging-new.up.railway.app` |
| staging | `frontend-web` | SUCCESS 2026-11-15 | `frontend-web-staging-new.up.railway.app` |
| production | `backend` | SUCCESS 2026-11-15 | `backend-production-1b33d.up.railway.app` |
| production | `frontend-admin` | SUCCESS 2026-11-15 | `frontend-admin-production-5b0c.up.railway.app` |
| production | `frontend-web` | SUCCESS 2026-11-15 13:32Z | `frontend-web-production-9259.up.railway.app` |

Two facts here change the design:

- **Development `frontend-web` is red today.** Its latest deployment failed on 2026-11-13. If the chain treats a failed development deploy as fatal, every release halts on a pre-existing failure that has nothing to do with the commit being released.
- **Production has a live `frontend-web` on Railway, and it is not what the customer domain serves.** `https://frontend-web-production-9259.up.railway.app/` returns 200 (85,258 bytes) and `https://www.spotlightng.com/` returns 200 (85,895 bytes), but their `/_next/static/chunks/` hashes differ — two different builds, deployed independently. So this is not a vestigial service; it is a *second production frontend-web writer* whose output nothing on the customer domain reads.

**`notification-worker` exists only in development** and is deployed by no workflow lane. It is a service the release chain does not know about; flagging it is in scope, adopting it is not.

**Two Railway CLI facts that must survive the move.**

- A frontend service with a Railway `rootDirectory` must be uploaded with **no positional path and no `--path-as-root`** (`railway up .` dies "prefix not found"). Only `ci.yml`'s staging matrix does this correctly (`path: ''`, `root_flag: ''`, invoked at `ci.yml:659`). The same defect is hardcoded in **three** places: `ci.yml:563` (development), `ci.yml:790` (production), and `development-deploy.yml:98`. All three pass a positional path with `--path-as-root` regardless of the service.
- The CLI's default HTTP timeout is 90s, which truncates the 93 MB `frontend-web` upload. `RAILWAY_HTTP_TIMEOUT` must be set on every `railway up`.

**`ci.yml` concurrency can kill a deploy mid-upload.** `concurrency: group: ci-${{ github.workflow }}-${{ github.ref }}` with `cancel-in-progress: true`. Any deploy that lives inside `ci.yml` on `main` is cancellable by the next push. The new chain must not be. `integration-verify.yml` uses the same shape (`integ-${{ github.ref }}`, cancel in progress).

**Both CI lanes skip docs-only `main` pushes.** `ci.yml` and `integration-verify.yml` each declare `push: branches: [main]` with `paths-ignore: ['**.md', 'docs/**']`. So a docs-only commit produces no check-runs at all — which a naive "wait for green" gate would read as a 40-minute timeout.

**`ci.yml`'s header comment is stale and asserts a mechanism that does not exist.** It says "Railway performs native GitHub deployments from these branches after its per-environment branch mapping is configured: develop -> Development, staging -> Staging, prod -> Production." No such mapping is configured: every service in every environment reports `source: null` (measured 2026-11-15), so a branch push cannot deploy anything and `railway up` is the only route. The comment must be corrected when the deploy jobs move out, or the next reader will believe a push deploys.

## Decisions

**A. Reconcile before flipping anything on.** No auto-deploy switch is turned on until `origin/prod` and `origin/staging` are reconciled into `main` as reviewed PRs — by merge, or by screened cherry-pick where a commit must not land (Phase 0 decides which). This is blocking, not parallel work.

**B. One new workflow owns the chain.** `.github/workflows/release.yml`, triggered by `on: push: branches: [main]`. `ci.yml` loses its three deploy jobs and becomes CI-only. The alternative (keeping deploys in `ci.yml` and dropping the conditions) was rejected: it inherits a `cancel-in-progress: true` group, and it leaves the required-check names entangled with deploy job names that `scripts/ci/test-changed-modules.py` asserts on.

**C. The chain waits for CI rather than racing it.** `release.yml` polls the head SHA's check-runs until every name in `.github/required-checks.txt` plus `integration-verify` reports `completed/success` (a `skipped` conclusion satisfies). A `workflow_run` trigger was rejected: it means two triggers and two racing releases for one push, and it behaves wrongly on a rollback dispatch.

**D. One apply path per database, owned by the chain.** The apply logic is extracted into a reusable workflow called by `release.yml`; `db-migrate.yml` loses its `push` triggers. This is not only tidiness — today the staging apply fires only on a push to the `staging` branch, so a `main`-only release model would stop migrating staging altogether (Migration ownership).

**E. Production `frontend-web` stays out of the deploy matrix.** The customer domain is released through `sync-frontend-web.yml` → cPanel, and it is ungated already. The Railway `frontend-web-production-9259` instance is a separate, differently-built second writer; pointing the chain at it would make the release write a third copy of production web, or silently change what that URL serves. Neither is part of "remove the manual approval". Whether that service should keep being deployed at all is a decision for the user, recorded under Out of scope.

**F. A development failure does not block the staging→production leg.** Development is a sibling branch off `gates`, not a predecessor. Two measured facts make a green-development requirement unshippable today: its `frontend-web` deployment FAILED on 2026-11-13, and its backend `/readyz` answers 503 because the DB pool is unreachable. A chain that required development to be green would halt every release on pre-existing failures unrelated to the commit being released. Development failures are reported loudly in the run and the job summary, and they fail the workflow's overall conclusion — but they do not gate production.

**G. A docs-only commit is a no-op release; a superseded commit never deploys.** `ci.yml` and `integration-verify.yml` both skip `**.md` and `docs/**` on a `main` push, and both cancel in progress per ref. `gates` reads those two behaviours rather than duplicating the filter: no CI run for the SHA ⇒ nothing to build, exit green as a no-op; a required check reported `cancelled` ⇒ a newer `main` commit owns this release, exit without deploying. Both inferences apply to `push` events only — on a `workflow_dispatch` rollback, a SHA with no CI run fails loudly instead of no-op'ing, because the operator asked for that specific commit. Details under Phase 1.

## Phase 0 — reconcile (blocking)

Bring the 6 prod-only and 4 staging-only patches onto `main`. Screen every candidate commit individually — not the branch as a unit — and record the verdict for each in the PR description.

**Default shape is a merge PR**: `origin/prod` → `main`, then `origin/staging` → `main`, each reviewed on its own. A plain merge lands everything on the branch, so it is only the right shape when screening finds nothing that must be excluded.

**When screening says a candidate must not land** (`6948a6c49` and `41c19ea2b` above are the two known judgement calls), the shape changes to a cherry-pick onto a fresh branch off `origin/main`, taking only the cleared commits, and the excluded one is written down with its reason. Decide per branch after screening; do not pick the shape before reading the commits.

**Done when:**

- `git cherry origin/main origin/prod` and `git cherry origin/main origin/staging` print no `+` lines, *or* every remaining `+` has a recorded reason for being deliberately excluded.
- All required checks are green on the merge/cherry-pick commits.
- `origin/prod` and `origin/staging` are fast-forwarded to `main` (or reset to it, if commits were excluded), so they cannot drift again while the promotion-branch model still exists.

## PR sequencing

Each of these is its own PR, in this order, and each is mergeable and revertible independently:

1. **Phase 0a** — `origin/prod` reconciliation.
2. **Phase 0b** — `origin/staging` reconciliation.
3. **Phase 1** — `release.yml` + `_reusable-db-apply.yml`, the `ci.yml` and `db-migrate.yml` trigger removals, the retirement of `development-deploy.yml`, and the `docs/devops/deployment-matrix.md` row update in the same PR (the matrix is canonical, so a workflow change that contradicts it must not land without it).

Phase 1 must not merge before Phase 0a and 0b are in. Turning on auto-deploy while `main` is missing production commits is the failure this sequencing exists to prevent.

## Phase 1 — `release.yml`

```yaml
on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      ref:
        description: 'Commit SHA to release (rollback to a prior main commit)'
        required: false
        default: 'main'
        type: string
      skip_gates:
        description: 'Rollback only — assert CI was green when this SHA was main'
        required: false
        default: 'false'
        type: boolean
```

- `concurrency: group: release-main`, `cancel-in-progress: false`.
- Whole workflow gated on `vars.RAILWAY_DEPLOY_ENABLED == 'true'` — the single emergency brake.
- Permissions scoped: `gates` needs `checks: read` and `actions: read` (it queries both check-runs and the run list); deploy jobs need `contents: read`.
- A `push` event can never set `skip_gates`, so the normal path has no bypass.
- In practice the `push` trigger fires when a PR merges into `main` (a squash merge creates the push event and a fresh SHA). Work is published by feature branch plus PR on this repo; nothing here changes that, and `main` is never pushed directly.

**Job graph**, stated as each job's `needs` so there is no ambiguity about what blocks what:

| Job | `needs` |
|---|---|
| `gates` | — |
| `deploy-development` | `gates` |
| `smoke-development` | `deploy-development` |
| `migrate-staging` | `gates` |
| `deploy-staging` | `migrate-staging` |
| `smoke-staging` | `deploy-staging` |
| `migrate-production` | `smoke-staging` |
| `deploy-production` | `migrate-production` |
| `smoke-production` | `deploy-production` |

The development leg (`deploy-development`, `smoke-development`) leaves `gates` side by side with the staging leg, runs concurrently, and appears in no production job's `needs` — Decision F. Nothing reaches production until `smoke-staging` is green.

**`gates`** polls `GET repos/{o}/{r}/commits/{sha}/check-runs` (with `--paginate` — an unpaged call produces a false all-green) for up to 40 minutes, requiring every name in `.github/required-checks.txt` plus `integration-verify` to reach `completed/success`.

Three outcomes it must distinguish, all of which are real on this repo:

- **Timeout is a failure, not a pass.** At 40 minutes the job exits non-zero, the summary lists every check that had not settled, and nothing is deployed anywhere. A release that cannot confirm CI is green does not get the benefit of the doubt.
- **No checks at all means a docs-only commit.** `ci.yml` and `integration-verify.yml` both carry `push: branches: [main]` with `paths-ignore: ['**.md', 'docs/**']`, so a docs-only push to `main` produces *zero* check-runs. `gates` therefore first waits, bounded at 5 minutes, for a `ci.yml` run to appear for the SHA (`actions/runs?head_sha=`). If none appears, the commit was filtered out and there is nothing to build: the chain concludes successfully as a no-op with a summary line saying so, and deploys nothing. `release.yml` deliberately does **not** duplicate the `paths-ignore` list — two hand-synced copies of a filter is the drift hazard `ci.yml`'s own header was rewritten to remove, so `ci.yml`'s filter stays the single source of truth and `gates` reads its consequence.
- **A cancelled check means this release was superseded.** Both lanes use `cancel-in-progress: true` on a per-ref group (`ci-${{ github.workflow }}-${{ github.ref }}`, `integ-${{ github.ref }}`), so a second commit landing on `main` cancels the first commit's CI. If `gates` sees `cancelled` for a required name it exits without deploying, and the summary says which newer run superseded it. Deploying the older commit would race the newer release; waiting would hang until timeout.

The "no checks at all ⇒ docs-only no-op" inference is **valid only for a `push` event**. On a `workflow_dispatch` rollback the target SHA may be old enough that its check-runs are past retention, and reading that as "docs-only, nothing to do" would silently skip the rollback the operator asked for. So on a dispatch, a SHA with no CI run makes `gates` **fail loudly** with that explanation, unless `skip_gates: true` was passed — which is the operator asserting CI was green when that SHA was `main`. A push event cannot set that input.

## Migration ownership

**The gap this closes.** `db-migrate.yml` triggers on `push: branches: [main, staging]` with `paths: ['supabase/migrations/**', '.github/workflows/db-migrate.yml']`, and *each job selects itself by branch*: `main` → production, `staging` → staging. So the staging apply only ever fires on a push to the `staging` branch. Once releases come from `main` alone and the promotion branches stop receiving work, **the staging migration would silently stop applying** and the staging schema would drift behind the code being deployed to it. `release.yml` must therefore own `migrate-staging` explicitly rather than inheriting it.

Extract the apply into `.github/workflows/_reusable-db-apply.yml`, called by:

- `release.yml` — before the code that needs it, per environment.
- `db-migrate.yml` — which **loses its `push` triggers** and keeps `workflow_dispatch` only (its `target` / `dry_run` / `include_all` inputs stay; they are how an operator dry-runs and repairs).

The reusable workflow inherits the Supabase CLI pin `2.114.0` (from `supabase/setup-cli@v3` — shared with `ops-db-push.yml` and `maps-ci.yml`, so any bump moves all three), the stale-ref guard, the additive-only guard, and the `Production` environment-level `SUPABASE_DB_PASSWORD`. Both enablement variables stay in force: `DB_MIGRATE_ENABLED` for production, `DB_MIGRATE_STAGING_ENABLED` for staging.

`db-migrate.yml`'s header comment recommends "(Recommended) Configure the `production` environment with required reviewers so each apply needs a human approval." That recommendation is reversed by this change and the comment must be updated in the same PR, or it will tell the next reader to re-add the gate that was just removed.

`ops-db-push*.yml` stay exactly as they are: manual operator tools for drift repair, not part of a release.

## Deploy matrix

| Environment | Services | Notes |
|---|---|---|
| development | `backend`, `frontend-web`, `frontend-admin` | absorbs `development-deploy.yml`; `frontend-web` is red today, so this leg reports and continues (Decision F) |
| staging | `backend`, `frontend-web`, `frontend-admin` | frontend services: no positional path, no `--path-as-root` |
| production | `backend`, `frontend-admin` | **`frontend-web` excluded** — the customer domain is released via `sync-frontend-web.yml` → cPanel (Decision E) |

`notification-worker` is deliberately absent: it exists only in development and no lane deploys it today. Adopting it into the chain is a separate decision (Out of scope).

Every `railway up` sets `RAILWAY_HTTP_TIMEOUT`. The `--path-as-root` defect is fixed in the move at all three sites — `ci.yml:563` (development), `ci.yml:790` (production), `development-deploy.yml:98` — by carrying staging's per-matrix `path` / `root_flag` shape instead of hardcoding the flag.

The upload form is templated per matrix entry, never hardcoded:

```
railway up ${{ matrix.path }} ${{ matrix.root_flag }} --no-gitignore \
  --service <name> --environment <env> --project e7dca861-3667-4d9a-8090-6d2f4d179ec2 \
  --detach --message <sha>
```

`backend` keeps `path: backend`, `root_flag: --path-as-root` (Railway builds `backend/Dockerfile` from the uploaded directory). The frontend services take `path: ''`, `root_flag: ''` in **every** environment. Then poll `railway deployment list ... --json` for an entry whose `meta.cliMessage` equals that SHA. CLI pinned `@railway/cli@5.40.1`.

## Verification contract

Each stage proves the environment is serving the new commit; a green job is not evidence on its own.

- **backend** (all three environments): `GET /api/v1/public/build` must answer `commit == github.sha` — verified working today on all three, returning `{"commit":…,"source":"ldflags","started_at":…,"uptime_seconds":…}` — plus `/healthz`. `/readyz` (which pings the DB pool, AUD-INFRA-007) is **required 200 in staging and production**; in development it is recorded but not required, because it answers 503 today for reasons unrelated to any release. The served `commit`, `started_at` and `uptime_seconds` are written to the summary, which also proves the process actually restarted rather than reporting an old build.
- **frontend services**: Railway deployment `SUCCESS` for that SHA, plus HTTP 200 on the console URL. A frontend build echoes no commit — there is no `generateBuildId` in `frontend-web/next.config` and the App Router HTML carries no `buildId` or `_buildManifest.js` reference (measured against both live production URLs) — so a deployment that reports SUCCESS while still serving stale bytes is indistinguishable from success on status alone. The smoke step therefore captures the `/_next/static/chunks/` hashes from the served HTML before and after, and writes a **warning** into the job summary when they are unchanged for a commit that touched that service's directory. A warning, not a failure: an unchanged chunk set has legitimate causes, and a false red would halt every release.
- Every stage writes the served commit into the job summary, so a release can be audited from the run page alone.

**URLs to probe, measured 2026-11-15:**

| Environment | backend | frontend-admin | frontend-web |
|---|---|---|---|
| development | `backend-development-502c.up.railway.app` | `frontend-admin-development-5a67.up.railway.app` | `frontend-web-development.up.railway.app` |
| staging | `backend-staging-new.up.railway.app` | `frontend-admin-staging-new.up.railway.app` | `frontend-web-staging-new.up.railway.app` |
| production | `backend-production-1b33d.up.railway.app` | `frontend-admin-production-5b0c.up.railway.app` | *not probed* — Decision E |

## Failure handling and rollback

- A red gate, a failed migration, or a failed staging smoke **stops the chain before production**. Nothing partial is written to production. A gate that ends because the commit was *superseded* exits without deploying but is not a failure — the newer run owns the release (Decision G).
- A failed Railway deploy leaves the previous deployment serving. Observed, not assumed: development `frontend-web`'s latest deployment is FAILED (2026-11-13) and `https://frontend-web-development.up.railway.app/` still answers HTTP 200.
- **A failed development deploy does not stop anything** (Decision F). It fails the workflow conclusion and the job summary says so, but the staging→production leg has already been running concurrently and completes on its own merits. This is the deliberate cost of removing approvals: a release can be green in production while the run is red in development, so the run page must be read, not just its overall colour.
- **Rollback:** `workflow_dispatch` with `ref=<prior SHA>`, plus `skip_gates: true` if that SHA's check-runs are past retention. Because migrations stay additive-only / expand-first, re-deploying an older commit is safe: the older code reads a newer-but-compatible schema. A rollback re-runs the same chain, so it migrates and smokes in the same order — it is not a separate, weaker path.
- The 40-minute gate budget bounds how long a release can hang waiting for CI before it reports failure rather than parking silently.

## Removed vs kept

**Removed**

- The `Production` required reviewers — *already done, 2026-11-15*.
- The dispatch / `confirm_deploy == 'DEPLOY'` / promotion-branch conditions on `ci.yml`'s three deploy jobs. Those jobs move out of `ci.yml` entirely, leaving it CI-only.
- `ci.yml`'s `deploy_environment` and `confirm_deploy` dispatch inputs go with them. `ci.yml` keeps `workflow_dispatch` (re-running CI against any branch is still useful) but with no deploy inputs, so a CI dispatch cannot express a release at all.
- The promotion-branch requirement (`github.ref == 'refs/heads/develop|staging|prod'`) as a *release* precondition. The branches themselves stay until Phase 0 fast-forwards them; retiring `develop`/`staging`/`prod` entirely is a later, separate decision and is not part of this change.

**Kept**

- `vars.RAILWAY_DEPLOY_ENABLED` as the brake.
- `development-deploy.yml`'s verified-from-main pattern — folded into the chain, then the file is retired.
- The cPanel production-web path (`sync-frontend-web.yml`).
- Every operator lane: `ops-*`, `*-module-flags`, signup codes, `sync-env-secrets`. These are not release steps and stay manual unless the user asks for a sweep.
- `.github/required-checks.txt` and its warning: renaming a job breaks every PR, and `scripts/ci/test-changed-modules.py` asserts those names still exist in `ci.yml`.

## Docs and local verification

Order matters — the matrix document is canonical and its own checklist says declare the row first.

1. Update `docs/devops/deployment-matrix.md` **first**, in the same PR as the workflow change.
2. Then `docs/launch/BRANCH-PROTECTION.md`, `docs/devops/DEPLOY-RUNBOOK.md`, and `docs/devops/production-migration-ledger.md`.
3. Correct the two stale header comments that now describe the opposite of the truth: `ci.yml`'s claim that "Railway performs native GitHub deployments from these branches", and `db-migrate.yml`'s recommendation to add `production` required reviewers (see Verified current state and Migration ownership).
4. Locally: `actionlint` on every changed workflow, and `scripts/ci/test-changed-modules.py` (it asserts every required-check name still exists in `ci.yml` — moving the deploy jobs out must not break that).
5. After merge: watch the first `main` push end to end and read each environment's served commit back from `/api/v1/public/build`. Do not report the release as successful on a green run alone.

## Out of scope

- **No development Supabase project exists** (only production and staging secrets are configured), so development stays on local/docker Postgres. The chain does not migrate a development database.
- `deploy.yml` (GCP) stays inert.
- `deploy-railway-action.yml` stays dark.
- **`frontend-web-production-9259` is not adopted and not deleted.** It is live and separately deployed (SUCCESS 2026-11-15 13:32Z), and it serves a *different build* from `www.spotlightng.com` (measured: both HTTP 200, differing `/_next/static/chunks/` hashes). Retiring it, or bringing it into the chain, changes what a live production URL serves and needs the user's decision — it is flagged here rather than folded in unasked.
- **`notification-worker` is not adopted.** It exists only in development (SUCCESS 2026-11-01), is deployed by no workflow, and has no staging or production counterpart. Whether it should be part of a release is a separate question.

## Recorded live state (as of writing)

- `origin/main` head: `6199a6b57`. The local `main` ref in the shared worktree is stale (`1835ad4de`) and must not be moved — other sessions work there. Publish via a feature branch off `origin/main` plus a PR; never push `main`.
- `Production` environment reviewers: removed.
- Parked `Ops DB Push` run `43723411971`: failed without executing. No production DB write occurred. Whether to re-dispatch it (`mode=push`, `confirm=PUSH`) is the user's call — it is a production database write and needs explicit authorization.
- Divergence: production serves `5ab7c9cc0`, staging serves `2a82a62ef`, neither an ancestor of `main`. Phase 0 exists because of this.
- Development backend serves `15975f64f` — an ancestor of `main`, but the process has been up since 2026-10-16, so development is 30 days stale rather than diverged. Its `/readyz` answers 503.
- Development `frontend-web`: latest Railway deployment FAILED (2026-11-13); the URL still serves 200 from the previous deployment.
- Production `frontend-web` on Railway (`frontend-web-production-9259`, deployed 2026-11-15 13:32Z) serves a different build from `www.spotlightng.com`. Two live production web writers, only one of which the customer domain reads.
- Everything above was measured on 2026-11-15 and is restated here so a reader in a later session can tell what was observed from what was assumed. Re-measure before acting on it.
