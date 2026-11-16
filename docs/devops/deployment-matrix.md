# Deployment Matrix (AUD-INFRA-003)

This is the canonical record of which deployment path is **authoritative** for
each service per environment. The repo accumulated five parallel deployment
stacks (Render blueprint, Railway configs, GCP Cloud Run terraform + workflow,
cPanel Passenger, EAS); several docs describe services on platforms they have
since left. When this matrix and a config file disagree, **this file wins** —
file a docs PR to correct it rather than silently re-pointing a config.

## Authoritative paths

| Service | Production | Staging | Mechanism | Evidence |
|---|---|---|---|---|
| `frontend-web` (Next.js) | cPanel Passenger (`spotlightng.com`) | Railway (`frontend-web-staging-new`) | **Prod:** push to `main` here → `sync-frontend-web.yml` ("Spotlight Frontend Web Safe Merge", gated on `vars.SPOTLIGHT_FRONTEND_SYNC_ENABLED`) copies `frontend-web/` into `paymax2022/spotlight-latest` `main` → **that repo's** ungated `Deploy to Namecheap cPanel (SSH)` lane builds, rsyncs, purges `.next/server/route-cache` and restarts Passenger — so a `main` push IS a production release. This repo's own `deploy-cpanel.yml` stays inert (`vars.CPANEL_DEPLOY_ENABLED` unset, secrets absent) and is not the writer. **Staging:** `release.yml`'s `deploy-staging` job (`railway up`). It is **not** a "Railway native git deploy from the `staging` branch" — that claim was wrong twice over, and [Railway git sources, measured 2026-11-16](#railway-git-sources--measured-2026-11-16) is the measurement that replaces it | `sync-frontend-web.yml:48` (destination repo), `spotlight-latest` Deploy-to-cPanel runs green on every sync (latest 2026-11-11), `deploy-cpanel.yml` header, `frontend-web/server.js`, `frontend-web/railway.json`, `eas.json` staging API URL |
| `frontend-web` (Railway **production** BFF) | `release.yml`, on every push to `main` | production | `frontend-web-production-9259.up.railway.app` | **A different host from the cPanel row above, and not interchangeable with it.** `www.spotlightng.com` is served by the cPanel lane (`sync-frontend-web.yml` → `paymax2022/spotlight-latest` → that repo's ungated cPanel workflow); `deploy-cpanel.yml` in *this* repo is inert (0 successes in 843 runs, `vars.CPANEL_DEPLOY_ENABLED` unset). This Railway instance is the BFF that `mobile-app/reactnative/eas.json:65` bakes into the shipped build's `EXPO_PUBLIC_API_BASE_URL` (and `production-apk` inherits at `:72`), and that `frontend-admin`'s production `WEB_API_BASE_URL` points at. Before `release.yml` nothing in the repo updated it — its 2026-11-15 deployment was a hand-run `railway up`. Because a store build bakes the base URL at submission time, a stale host here cannot be re-pointed without a new submission. |
| `backend` (Go API) | Railway `production` service `backend` (`backend-production-1b33d.up.railway.app`) | Railway `staging` service `backend` (`backend-staging-new.up.railway.app`) | `release.yml` on every push to `main` (Railway `railway up`, per environment). Migrations are applied to that environment first — `migrate-staging` before `deploy-staging`, `migrate-production` before `deploy-production`. `/api/v1/public/build` reports the served commit, stamped via `backend/BUILD_COMMIT` + `-ldflags`. GCP Cloud Run remains the **intended** target of `.github/workflows/deploy.yml` (sha-tagged image → staging → 10% canary → human-gated promotion), but every one of its jobs is skipped while `vars.GCP_PROJECT_ID` is unset | live `GET /api/v1/public/health` 200 on both Railway hosts and `NXDOMAIN` for `api.spotlightng.com`; `deploy.yml:34` gate, 100/100 `skipped` runs in its history; `infra/terraform/cloud-run.tf`. **Serving binary measured 2026-11-14** — `curl -s https://backend-production-1b33d.up.railway.app/api/v1/public/build` → `{"commit":"585bd2ca7fab5c0a5adf9e67ab40b04068e9cee0","source":"ldflags","started_at":"2026-11-13T09:48:09Z"}` (staging, read the same minute, answers `2a82a62ef…` — the same commit as its `origin/staging` tip at that reading). `585bd2ca7…` is the tip of `origin/chore/promote-prod-module-readiness` (PR #996) and is **not an ancestor of `origin/main`** (`git merge-base --is-ancestor` → false); against the pin below it is 7 commits ahead-side / 713 behind (`git rev-list --count` both directions). **PENDING, NOT DONE — the release-SHA cutover:** nothing in this plan has deployed, dispatched or pushed this service. Bringing prod to `RELEASE_SHA c49b395643473ba6ff7a225d7a7a339a41eddfe6` is **Task 11**, still open, and ledger §10.6 requires re-reading `/api/v1/public/build` at execution time instead of quoting any figure stored in a doc — including the one above. |
| Backend workers (asynq) | Render `spotlight-notification-worker` | Render | `render.yaml` worker service (AUD-INFRA-006). **Not deployed by `release.yml`** — no matrix in it names `notification-worker`, on purpose. Production's consumer is Render's `spotlight-notification-worker`; a Railway production worker would put two consumers on one queue with the same `REDIS_URL` and double-deliver every push, email and SMS. See "`notification-worker` version state" below for the open question about which branch its Render blueprint tracks. | `render.yaml` |
| `frontend-admin` (Next.js) | `admin.spotlightng.com` (cPanel) | Railway (`frontend-admin-staging-new`) | cPanel Passenger host; `frontend-admin/railway.json` for staging | `backend/internal/config/config.go` `ADMIN_APP_BASE_URL` default, `frontend-admin/railway.json` |
| `mobile-app/reactnative` | EAS `production` profile | EAS `staging`/`preview` profiles | `eas build -p android --profile <p>`; store distribution out of band | `mobile-app/reactnative/eas.json` |
| Postgres + GoTrue | Supabase cloud | Supabase cloud (shared project) | **Superseded on 2026-11-16, by PR B:** `db-migrate.yml` is dispatch-only — its `push:` trigger is gone, and `release.yml`'s `migrate-staging` / `migrate-production` jobs are now the automatic applies, each ahead of its own environment's deploy, sharing `_reusable-db-apply.yml` with the manual lane. The rest of this cell is kept as the 2026-11-14 measurement it was, because the reviewer history and the lane census in it are what justify that single apply path; read it as history, not as today's triggers. **`db-migrate.yml` was NOT dormant then** (corrects the earlier "dormant by design (AUD-INFRA-005)" claim, which was false). Measured 2026-11-14: it then triggered on `push` to `branches: [main, staging]` with paths `supabase/migrations/**` **and** its own file (`db-migrate.yml:40-43`), and its `apply` job runs when `(workflow_dispatch && target=='production') \|\| (push && ref=='refs/heads/main' && vars.DB_MIGRATE_ENABLED=='true')` (`:79-81`) under `environment: production` (`:83`), **which has required reviewers** — measured 2026-11-14: `gh api …/actions/runs/<parked run id>/pending_deployments` returns the deployment parked on environment `Production` with a populated `reviewers` array of two `User` entries and `wait_timer: 0` — the run ids themselves are held once, in ledger §16.2 item 1, which owns them. (An earlier draft of this cell called that fact "unconfirmed" because `…/environments/Production/deployment_protection_rules` reads `[]`; that endpoint lists *custom* protection rules such as wait timers, not required-reviewer rules, so `[]` is the expected answer and proves nothing. `pending_deployments[].reviewers` is the field to read, and it names who can approve.) Both switches are on today: `gh api …/actions/variables` → `DB_MIGRATE_ENABLED=true`, `DB_MIGRATE_STAGING_ENABLED=true`. So three lanes could write the DB at that reading — `db-migrate.yml` (gated by `Production`'s required reviewers, and one of its runs was parked when measured), `ops-db-push.yml` (manual, same gate, also parked at that reading) and `ops-db-push-scoped.yml` (`environment: production-db-scoped`, whose 2026-11-12 run was not parked at all, and it refuses the staging ref) — plus the bare `supabase db push` of the reconciliation runbook. PR B adds a fourth, and it is the only automatic one: `release.yml`'s two migrate jobs → `_reusable-db-apply.yml`. The `Production` required reviewers that gated the first three were removed on 2026-11-15, so nothing in that census still parks a run — see `docs/launch/BRANCH-PROTECTION.md`. `gh api …/actions/runs?status=waiting` and `status=pending` were both re-run on 2026-11-14: two writes sit parked on the `Production` gate and one further run had not reached an environment job. Their ids, heads and timestamps are recorded once — ledger §16.2 item 1 owns them, so this table deliberately does not repeat them (a fourth copy of a live run state is a fourth way to be stale). **Nothing in this plan approved, declined, dispatched or pushed any of them.** | `docs/devops/cloud-migration-reconciliation-runbook.md`; ledger §1.3-§1.4, §5.7, §16 |
| Redis / asynq broker | Render `spotlight-redis` | same | `render.yaml` service | `render.yaml` |
| `release.yml` | `on: push: branches: [main]` (plus `workflow_dispatch` for rollback) | development, staging, production — Railway, via `railway up` | `backend`, `frontend-web`, `frontend-admin` in each; migrations applied per environment before that environment's deploy | The ONLY automatic writer of any Railway environment. One brake: `vars.RAILWAY_DEPLOY_ENABLED`. No reviewer, no typed confirmation, no promotion branch. "Automatic" is scoped to this repo: the staging services still carry Railway repo connections, and [Railway git sources, measured 2026-11-16](#railway-git-sources--measured-2026-11-16) records what would make one of them a second writer — and that it is not the frozen promotion branches. |

## Non-authoritative / legacy configs

These files still exist and are **not** the deploy path for their namesake
environment. They are kept for reference or partial use; do not edit them
expecting a deploy effect, and do not delete them without checking this list:

| File | Why it exists / status |
|---|---|
| `render.yaml` `spotlight-backend` web service | Render was the backend host pre-Cloud-Run; the **worker + Redis services in the same file are still live** — retire the web service only after confirming nothing points at it. |
| `backend/railway.json`, `frontend-web/railway.json` | Railway hosts staging frontend-web; backend/admin Railway configs are leftovers from the Render→Railway→GCP drift. |
| `backend/app.yaml`, `frontend-admin/app.yaml`, `mobile-app/reactnative/app.yaml` | cPanel Passenger manifests; only frontend-admin's is believed live. |
| `deploy-gcp.sh`, `deploy-render.sh`, `deploy-mobile.sh` | Ad-hoc scripts predating the GitHub-Actions lanes; use the workflows instead. |
| `.github/workflows/deploy-railway-action.yml` | An **orphan**, not an alternative to anything. It is `workflow_dispatch`-only (inputs: `environment`, `service`, a typed `DEPLOY`) and calls the `bervProject/railway-deploy` action; `grep -rn "deploy-railway-action" .github/` matches only its own `name:` and `concurrency.group:` lines, so no workflow and no job needs it. `release.yml` does not use it — the chain deploys with `scripts/ci/railway-deploy.sh` (three call sites: development, staging, production). Dispatching it takes `confirm == 'DEPLOY'` **and** `vars.RAILWAY_DEPLOY_ENABLED == 'true'` **and** its own `vars.RAILWAY_ACTION_DEPLOY_ENABLED == 'true'` (the `deploy` job's `if:` — the last is unset, so the lane is dark), and even then its `Gate - promotion branch and valid target` step refuses a run unless each environment comes from `refs/heads/develop` / `staging` / `prod` — branches this file records as frozen, so a dispatch from `main` cannot pass its own gate. Creating a second writer therefore means re-targeting that gate, not just flipping the switch. |
| `mobile-app/reactnative/vercel.json` | For the Expo **web export** preview, not native builds. |

## Promotion model

**Retired 2026-11-15.** There are no promotion branches in the release path any more.

A push to `main` is the release. `release.yml` waits for that commit's CI to go
green, then deploys development (non-blocking) and staging → production
(sequential, each environment's database migrated before the code that needs it,
nothing reaching production until staging has been probed and is serving the new
commit). There is no `workflow_dispatch` **release** — the only dispatch left on
this chain is the rollback below — no typed `DEPLOY` confirmation, no
`develop` / `staging` / `prod` branch to merge into, and no GitHub Environment
reviewer anywhere on the path — the `Production` environment's reviewers were
removed on 2026-11-15 (~16:34Z).

Two controls remain:

- **Brake:** set the repository variable `RAILWAY_DEPLOY_ENABLED` to anything
  other than `true` and the whole chain stops at its first job.
- **Rollback:** `workflow_dispatch` on `release.yml` with `ref=<prior main SHA>`.
  A rollback deliberately **does not apply migrations** — an older
  `supabase/migrations/` tree makes `supabase db push` abort with "remote
  migration versions not found in local migrations directory". Add
  `skip_gates=true` only if the SHA is old enough that its check-runs are past
  retention.

`db-migrate.yml` still exists but is dispatch-only: an operator tool for a
one-off apply, sharing one apply path (`_reusable-db-apply.yml`) with the chain
so there is exactly one way each database gets written.

## Promotion branches retired 2026-11-15 — DO NOT MERGE

`origin/prod` and `origin/staging` still point at commits whose file trees are
**older** than `main`'s. Screening every candidate file by file (spec:
`docs/superpowers/specs/2026-11-15-auto-deploy-release-pipeline-design.md`,
"Verified current state" — that path is on PR #1034's branch
`feat/auto-release-pipeline` and is **not on `main` yet**, so it does not resolve
from this branch until that PR merges) found **no content on either branch that `main`
lacks**. `git cherry` marks eleven commits `+` (re-run 2026-11-15 after Task 1:
seven on `prod`, four on `staging`), but a `+` means the *patch-id* was
not found upstream — it does not mean the content is missing. Six are already on
`main` in content; three are cases where `main` has moved ahead and merging would
revert it; two resurrect deliberately deleted code. That is 6 + 5, matching the
five-row table below and the six-item already-on-main list after it.

The tips are preserved as tags `archive/prod-2026-11-15` (`76f1a6103`) and
`archive/staging-2026-11-15` (`2a82a62ef`) so the branches can be reset without
losing history.

**These five commits must never be merged into `main`:**

| Commit | What merging it does |
|---|---|
| `41c19ea2b` promote main→prod (2026-10-17) | Resurrects the KYC admin-escalation plane that #808 (`2e22dfa7f`) deliberately deleted — 18 of its files no longer exist on `main`. |
| `616900caf` academy console (#1030) | Reverts the academy composite tuition model (`AcademyPricingKey`, `max_students`, `training_schedule`) back to the older flat `capacity`. |
| `973b010cc` academy BFF plane (#1031) | Reverts three feature flags (`referralRewards`, `estateDualControl`, `filmAcademyAssessment`) and downgrades `next` from `^16.4.3` to `^16.4.0`. |
| `2a82a62ef` promote #1014 to staging (2026-11-14) | Reverts 601 lines of `contracts/intake.openapi.yaml` + `contracts/openapi.yaml`. |
| `6948a6c49` gated staging deploy lane (2026-11-04) | Re-creates `staging-frontend-web-deploy.yml`, which `b5bc4480f` deleted under the policy "deploy only to `main`, never staging" — two live writers for one service-environment pair. |

The other six candidates (`548d07c4b`, `dae77e90b`, `5ab7c9cc0`, `75482a43a`,
`95beea87f`, `76f1a6103`) are already on `main` in content; `5ab7c9cc0` is the
commit production was serving when this was first screened.

`76f1a6103` (#1033, merged into `prod` 2026-11-15T19:39:59Z, *after* the original
screening) is the archived `prod` tip and needs its own note, because it is the one
candidate whose **commit graph** and **content** disagree. It is a forward port of
four `frontend-admin` sidebar files taken from `main` commit `8ec1681f5`, which IS
an ancestor of `origin/main`; all four blobs are byte-identical between
`76f1a6103` and `origin/main` (verified with `git rev-parse <sha>:<path>` on both
sides). So merging it would add nothing — but `git merge-base --is-ancestor
76f1a6103 origin/main` says NO, because the port was re-committed on `prod` rather
than cherry-picked with its patch-id intact. Do not read that NO as missing work.

**The residual risk is semantic, not genealogical.** Git screening proves no
*commit* is missing; it cannot prove that where `main` reimplemented something
differently, it covers every edge case the promotion-branch version did. That
risk is retired by the probe contract in the checklist below — staging smoke
before production — not by more archaeology.

### `prod` advanced again on 2026-11-16 — re-screened

Everything above is the 2026-11-15 screening, left as recorded. It is now
superseded on three points, measured live:

`d9a2ced41` (#1039, "port the assessment plane (question bank, review, exams) to
prod") merged into `prod` at 2026-11-16T07:02:14Z, so `origin/prod`'s tip is no
longer the archived `76f1a6103`. `git cherry -v origin/main origin/prod` now
marks **eight** `+` commits on `prod`, not seven.

**Does production hold code `main` cannot deploy? No.** #1039 touches 14 files.
Eleven are byte-identical between `d9a2ced41` and `origin/main` — the three
assessment services under `frontend-web/src/server/services/academy/assessment/`
and all eight `frontend-web/app/api/admin/academy/{exams,questions}…` routes —
and both branches' `frontend-admin/app/admin/academy/film/page.tsx` carry the
same eleven tabs, `assessment`, `bank` and `exams` included. The other three files
(`film/page.tsx`, `frontend-admin/src/services/filmAcademyAdminService.ts`,
`frontend-web/src/lib/feature-flags.ts`) differ, and in all three **`prod` is
behind `main`**: `prod` still carries the flat `capacity` / `fee_frequency` /
`installments_count` batch model that `main` replaced with the composite
per-format model (`AcademyPricingKey`, `max_students`, `training_schedule`,
`duration_weeks`), and its `feature-flags.ts` is an older revision (1 insertion,
19 deletions against `main`). So the section's central claim survives — but the
same mistake #1030 made is being repeated: **merging `prod` into `main`
re-introduces the flat-capacity admin console.**

The consequence for the first auto-release: the tree on `prod` still carries
the older console, and the first `release.yml` production leg replaces
whatever production is serving with `main`'s composite-pricing version. Which
model production's admin console is on **right now** depends on its last
promotion, and this file does not claim to know — no read of served bytes for
`frontend-admin` production was taken during this re-screen. What is certain is
the direction of the change: `main` is ahead, so the first release moves that
page forward, and it changes a page someone else shipped this morning. Read the
production `frontend-admin` chunk fingerprint before believing the deploy.

It is therefore a **sixth** commit that must never be merged into `main`. It is
recorded here instead of in the table above because that table's intro ("these
five commits") and the `6 + 5` arithmetic in the paragraph before it are the
2026-11-15 screening, and re-deriving the staging side is not today's work.
Any future re-screen should restate both branches from `git cherry` rather than
edit these numbers in place.

**Method note, because two instrument failures nearly produced the opposite
answer.** `git show --stat` *elides* long paths with `.../`, and reading
`.../server/services/academy/assessment/attempts.ts` as `backend/…` rather than
`frontend-web/src/…` made three files look invented; and the comparison loop
first ran `git rev-parse $R:$path`, which zsh parses as `$R` followed by the
`:f` **parameter modifier**, rewriting the path — so both sides reported the
file missing and `rev-parse` printed a commit SHA on stdout with its error
discarded. Take paths from `git show --name-only`, and build `"$REV:$path"` into
its own variable. A probe that says "absent from everything" is an instrument
failure, not a finding.

## `notification-worker` version state — UNVERIFIED FROM THE REPO

Production runs the asynq consumer as Render's `spotlight-notification-worker`
(`render.yaml:76-84`, `type: worker`, `startCommand: /app/notification-worker`,
`autoDeploy: true`, built by `Dockerfile:18`). `release.yml` does **not** deploy
it, and no file under `.github/` mentions it at all. There is no Railway
production worker on purpose: two consumers on one queue with the same
`REDIS_URL` would double-deliver every push, email and SMS. The production
Railway `backend` service does not set `RUN_WORKERS_INPROCESS` and
`backend/internal/config/config.go:1234` defaults it to `false`, so the web
service does not drain the queue in-process either.

**The worker's deployed commit is unknown and cannot be determined from this
repository.** No Render credentials exist in repo secrets or variables, so no
workflow or local command here can read it.

To verify by hand: Render dashboard → service `spotlight-notification-worker` →
latest deploy → note the commit SHA, then
`git merge-base --is-ancestor <sha> origin/main && echo ancestor`.

**Both branches of the consequence, written down because only one of them is
safe:**

- If the Render blueprint tracks **`main`**, then a push to `main` already
  redeploys the worker, it stays level with the web service, and no skew is
  possible. Nothing to do.
- If the Render blueprint tracks **`prod`**, the worker froze on 2026-11-14 when
  `prod` last received work — and now that `prod` receives nothing at all, it is
  frozen permanently. Worker and web service share one compiled contract
  (`backend/cmd/notification-worker/main.go:28` registers handlers through
  `notifications.Workers(mux, …)`, the same `backend/internal/notifications`
  package the web service enqueues from, both binaries from one `Dockerfile`),
  so a new web service can enqueue payloads the old worker decodes incorrectly.

Until this is checked, treat a new enqueue-shape change as **requiring a manual
Render deploy of the worker** alongside the release.

Record the finding here, with the date and the SHA, once it is checked.

## Railway git sources — measured 2026-11-16

Two rows of this file described the same staging services in incompatible ways: one
said staging `frontend-web` is deployed by "Railway native git deploy from the
`staging` branch", and elsewhere the repo asserted those services carry a git source
on `main`. Both cannot be true, and neither was written as a measurement. This is
the measurement, and it retires both claims.

Read-only commands against project `e7dca861-3667-4d9a-8090-6d2f4d179ec2` with
`railway` 5.71.0 (`development` `87489af5…`, `staging` `6b5f27a3…`, `production`
`f84c4558…`): `service list --json`, `deployment list --json`, and `railway api`
for `deploymentTriggers`.

**1. Which services are repo-connected.** `service list` → `source.repo`:
development's four app services and production's three both report `null` for every
service; only staging's `backend`, `frontend-web` and `frontend-admin` report
`paymax2022/spotlight-latest1` (`Redis` reports an image, not a repo). Production
therefore cannot be webhook-deployed at all — the services `release.yml` writes have
no git source attached to them.

**2. What branch that source resolves to.** Not readable as a setting: `ServiceSource`
exposes only `image` and `repo`, and `ServiceInstance` has no `autoDeploy` and no
branch field in this API version. It *is* readable from what the connection built.
Every staging deployment carrying git metadata — a build, as opposed to a `railway up`
upload, which sets `commitHash: null` and puts the source SHA in `cliMessage` —
reports `branch=main`. None has ever reported `staging`:

- `2026-11-02T11:18:20Z` — backend, `frontend-web` and `frontend-admin` inside 100 ms
  of each other, `branch=main sha=886d857f1`; then 11:19–11:23Z and 12:13:33/40Z, same
  SHA. That commit's committer date is `2026-11-01T18:27:32Z`, so these follow a push
  of main ~17 hours later rather than its merge.
- `2026-11-02T15:56:15Z` — `frontend-web`, `branch=main sha=afc460777`, FAILED. That
  commit's committer date is `15:47:50Z`, so the build started **8m25s after the
  commit landed on main** — the timing signature of a push webhook, not a hand press.
- `2026-11-15T09:55:37Z` — `frontend-web`, SUCCESS, `branch=main sha=f86f29979`
  (#1026, on main since `08:54:25Z`). One service, an hour after the commit.
- Everything from 2026-11-13 onward is a CLI upload: `commitHash: null`,
  `cliMessage` holding a SHA or a sentence like `deploy frontend-admin from main
  2394e8aa`, usually with `cliCaller: agent_unknown:shell:qoder`.

So the connector's branch is `main`, and it has built `main` as recently as
2026-11-15 — and once (11-02, `afc460777`) with a latency that only a push trigger
explains.

**3. Whether a trigger is armed today.** `deploymentTriggers(projectId,
environmentId, serviceId)` returns **zero edges for every service in all three
environments**, including the three repo-connected staging ones. The query is not
silently inert: a deliberately bogus serviceId raises `INTERNAL_SERVER_ERROR` rather
than an empty list, so the service record is consulted and the answer really is
"none listed". Read that as *the public API lists no trigger*, not as proof Railway
cannot deploy on push — `DeploymentTrigger` also carries `checkSuites` and
`provider`, which look like CI-gated triggers rather than plain push webhooks, and
the three later main pushes of 2026-11-15 (committer dates 15:50:49Z, 16:16:21Z,
20:49:01Z) produced no staging build at all.

**The consequence — what the two retired claims were actually about.**
`release.yml` is the intended writer of staging, and nothing in this repo makes
staging's git connections its co-writers. But the protection is not the branch
freeze: **the connection points at `main`, so re-arming it would fire on exactly the
pushes `release.yml` deploys**, making it a second live writer of `backend`,
`frontend-web` and `frontend-admin` in staging — the scenario checklist item 2
exists to forbid — with the same repo, the same `rootDirectory: frontend-web` and the
same `configFile: /frontend-web/railway.json` (both read from a 2026-11-15 build's
metadata). Two writers of one service-environment pair would race for "which build
is current", and the chain's chunk fingerprint could then change, or fail to change,
for a reason no commit caused.

Un-freezing `develop` / `staging` / `prod` has nothing to do with it; this plan's
draft asserted the connector "does not fire on `main`", and the metadata above
disproves that. Removing a staging service's repo connection is an operator action in
Railway's dashboard, outside this repo's blast radius, and **has not been done** —
until it is, treat the staging connections as armed-but-unfired rather than absent,
and treat a green `deploy-staging` as necessary evidence, not sufficient, for
"staging is serving this commit" (the probe contract below is what closes that gap).

## Probe contract

A green deploy job is not evidence. Every stage reads back what the environment is
actually serving (`scripts/ci/railway-smoke.sh`):

| Service | Probe | Passes when |
|---|---|---|
| `backend` | `GET /api/v1/public/build`, polled 20×15s | `.commit` equals the released SHA. Also records `started_at` and `uptime_seconds`, so "a build exists" cannot pass for "the process restarted". |
| `backend` | `GET /healthz` | 200. |
| `backend` | `GET /readyz` | 200 in staging and production. In **development** it is recorded as a warning, not a failure — development's DB pool is unreachable today (503), a pre-existing condition no commit caused. |
| `frontend-web` | `GET /` | 200, plus a chunk-fingerprint comparison. |
| `frontend-admin` | `GET /admin/login` | 200, plus a chunk-fingerprint comparison. |

The **chunk fingerprint** (`scripts/ci/frontend-fingerprint.sh`) is a digest of the
served `/_next/static/chunks/` filenames. It exists because a frontend build echoes
no commit anywhere — there is no `generateBuildId` in `frontend-web/next.config`,
and the App Router HTML carries no `buildId` and no `_buildManifest.js` reference —
so nothing else can distinguish "the new build is being served" from "the old bytes
are still there". An unchanged fingerprint when the commit touched that service is
a **warning**, never a failure: it can also mean the change was server-side only,
or that an edge cache is still warm. It is loud because the cPanel lane once shipped
a stale build for exactly this reason (Next 16's `.next/server/route-cache`
survives `rm:false`).

Host names live in exactly one file, `scripts/ci/railway-urls.sh`, sourced by both
the pre-deploy fingerprint step and the post-deploy probe, so the two can never
disagree about which host they mean. An unknown environment/service pair returns
empty and the probe fails loudly rather than curling a guessed host.

## Manual writers still in the tree — measured 2026-11-16

`release.yml` is the only **automatic** writer. Checklist item 2 bans two live writers of one
service-environment pair, and a dispatch is a writer a release cannot see, so Task 9's sweep read
every command in `.github/workflows/` that can move a Railway service — `railway up`,
`railway redeploy`, `scripts/ci/railway-deploy.sh`, and any third-party deploy action, with comments
excluded. Three workflow files remain, in four distinct write paths. All are `workflow_dispatch`-only,
so none of them violates the automatic-writer claim; two of them can still overwrite what a release
shipped.

| Lane | Pair it writes | How | Guard |
| --- | --- | --- | --- |
| `staging-module-flags.yml` → `set-flags`, `set-frontend-web-flags`, `rotate-admin-key`, `set-web-base-url`, `set-insurance-key` | staging `backend`, `frontend-web`, `frontend-admin` | `railway redeploy … --from-source` | job-level `if: inputs.confirm == 'SET'`, plus each job's own boolean |
| `staging-module-flags.yml` → `fix-proxy`, `rotate-admin-key` | staging `frontend-web`, `frontend-admin` | `railway up --path-as-root` of an **`actions/checkout` of `ref: staging`** | same |
| `prod-module-flags.yml` → `redeploy` | production `backend`, `frontend-admin`, `frontend-web` | `railway redeploy` **without** `--from-source` | `inputs.confirm == 'PRODUCTION-SET'` + `inputs.redeploy` |
| `deploy-railway-action.yml` → `deploy` | any of 3 services × 3 environments | `uses: bervProject/railway-deploy@4a1cfdb…` (0.2.0-beta, SHA-pinned) | `confirm == 'DEPLOY'` + `vars.RAILWAY_ACTION_DEPLOY_ENABLED` (unset) + a gate step refusing any ref that is not the matching promotion branch |

**What this change did to them.** `--from-source` is the load-bearing word: the CLI's own help says a
plain redeploy re-runs "the existing build or image … as-is" and only `--from-source` "pull[s] the
latest commit … from the configured source". Staging's three services are the only ones with a
configured source ([above](#railway-git-sources--measured-2026-11-16)), and that source's branch is
`main` — so those five redeploy steps pull the same tree `release.yml` uploads, but with the
service's own `railway.json` build path, **no CI gate, no migration-first ordering and no smoke
probe**. That was true before this PR and is true after; what is new is that the uploads and the
pulls now have one owner to compare them against. `prod-module-flags.yml` states the rule the others
should follow: no `--from-source` on production, ever, because it would build the connected branch
into the environment that is supposed to hold a promoted release.

**New hazard, dated 2026-11-16:** the two `railway up` steps check out `staging`, and this change
froze that branch at `archive/staging-2026-11-15` (2026-11-02 code). Dispatching `fix-proxy`, or
`rotate-admin-key` with its rebuild half, now **overwrites whatever the last release put on staging
with a two-week-old tree** — silently, because the job is named for the variable it sets, not for
the deploy it performs. Not fixed here: retargeting another lane's deploy source is a bigger
decision than removing a manual gate, and those jobs do set variables nothing else can. The options
are to point the uploads at `main`, to drop the rebuild halves now that `release.yml` owns staging,
or to leave them and require the operator to re-run `release.yml`'s staging leg afterwards. Needs the
user's word.

`prod-module-flags.yml`'s restart is code-safe (no `--from-source`, and its
`expected_build_commit` input exists to prove the same build came back) but that input **defaults to
`585bd2ca7…`** — the build production served when the lane was written. Its
"Read the production build identity BEFORE restarting" step exits 1 on a mismatch, so after the
first automatic release the lane refuses to run until the operator passes the live SHA. Failing
closed is right; the default is a trap, so pass the input explicitly.

**Method note, because it changed the answer:** `grep -rln "railway up" .github/workflows/` lists
`ci.yml` and `staging-inspect.yml`, which deploy nothing — the match is prose in `ci.yml`'s corrected
header comment and in a `meta` description. Reading `run:` blocks instead of files gives the only
defensible result: among workflows that fire on a push to `main`, **`release.yml` alone** issues a
Railway write, at its three `Deploy <service>` steps. A textual grep is a lead, not a verdict.

## Reconciliation checklist (when adding a deploy path)

1. Declare the service's row here FIRST, marking the old path's status.
2. One path per service per environment — never two live writers. The dispatch-only exceptions, and
   the one that can now overwrite a release with a frozen branch, are named in
   [Manual writers still in the tree](#manual-writers-still-in-the-tree--measured-2026-11-16).
3. The canary/probe contract is `/healthz` + `/readyz` (AUD-INFRA-007).
4. Migrations are applied BEFORE traffic via the additive-only chain
   (AUD-INFRA-005 tracks automating this).
