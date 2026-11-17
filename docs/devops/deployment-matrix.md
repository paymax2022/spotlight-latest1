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
and both branches' `frontend-admin/app/admin/academy/film/page.tsx` expose
eleven tabs whose `key` values match across the two — a coincidence of count
with the eleven identical files, because these are labels (`batches`,
`applications`, `tuition`, `curriculum`, `progress`, `submissions`,
`assessment`, `bank`, `exams`, `topics`, `settings`). The other three files
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

## `rootDirectory` is per environment — measured 2026-11-16

THE UPLOAD RULE in `scripts/ci/railway-deploy.sh` used to assert that "both frontends
carry a Railway `rootDirectory` of their own folder", and `release.yml`'s three deploy
matrices were written to match. That is true of **staging only**. Measured with
`railway api` on
`serviceInstance(serviceId:"…", environmentId:"…"){ rootDirectory }`:

| service | development | staging | production |
|---|---|---|---|
| `frontend-web` | `None` | `'frontend-web'` | `None` |
| `frontend-admin` | `None` | `'frontend-admin'` | `None` |
| `backend` | `None` | `None` | `None` |

`railway up` ships the archive it is pointed at, and Railway then resolves the
service's `rootDirectory` **inside that archive**. The two upload shapes are therefore
forced, not stylistic:

- `rootDirectory` set → upload from the repo root, no positional path and no
  `--path-as-root`. **staging**.
- `rootDirectory: None` → the archive root must BE the app folder, i.e.
  `railway up frontend-web --path-as-root`. **development and production**.

Both failure modes have now been seen on real hosts, which is why this is recorded
rather than reasoned about:

- **repo root into development** — the deploy reported SUCCESS, and `smoke Development`
  then failed with `/admin/login` answering 404: the service had built the monorepo
  root, which serves neither app. Re-uploading the *same commit* as
  `railway up frontend-admin --path-as-root` returned `http=200` on the same host with
  fingerprint `c9bd85cf9936f65e`. A successful upload is not a correct upload.
- **app folder into staging** — dies client-side during indexing with "prefix not
  found", because Railway looks for `frontend-*/` inside an archive that already *is*
  that folder. (`railway up .` with an explicit `.` fails the same way.)

## Release chain, first full run 2026-11-16 — two defects (both root-caused) and one operator exception

`release.yml` (#1037) had never run end to end. Its first run on `ef97ec64b` produced:

- **F1 — wrong upload shape for development and production** (the section above).
  Fixed in `.github/workflows/release.yml` by giving `deploy-development` and
  `deploy-production` the app-folder shape and leaving it out of `deploy-staging`,
  whose rows are the only correct ones. **Verified from CI on 2026-11-16** — run
  43905969462's three development legs (`--path-as-root`, CLI 5.40.1) all deployed green
  and their smokes passed, where before the fix `frontend-admin`/`frontend-web` were
  uploaded as the monorepo and the smoke died on `/admin/login answered 404`. F2 below
  is the only remaining red in that run.
- **F2 — `deploy Staging` legs died in under half a second** with
  `Failed to fetch: error decoding response body`, before any upload began, so
  `migrate-production` and `deploy-production` were skipped and **the chain could not
  deliver production at all**. All three legs (backend, frontend-web, frontend-admin)
  failed identically while the development legs of the same run succeeded, on the
  *same* pinned CLI (`@railway/cli@5.40.1`), the *same* command line and the *same*
  service/environment IDs.

  The clean specimen is **run 43905969462** — a release dispatched at main's own head
  `f90b3ef30`, so nothing about it is instrumentation (jobs 133438116988 /
  133438117010 / 133438117078):

  | wall clock | what the same runner was doing |
  |---|---|
  | 16:23:12 | `migrate-staging` and all three **development** deploy legs start |
  | 16:23:32 / :33 / :38 | all three **staging** legs print `UPLOAD_PATH` and die 452 ms, 1151 ms and 500 ms later on `expected value at line 1 column 1` |
  | 16:24:01 / :34 / 16:25:15 | those same three development legs finish **green**, and their smokes pass at 16:25–16:26 |
  | 16:34:46 / :52 | the identical single-shot `railway up` to staging succeeds in **2526 ms and 2554 ms** (run 43908996999, deployments `bb196119` / `5b468e3c`) |

  So within one minute and one project the fault took out staging three-for-three while
  development uploaded normally, and eleven minutes later staging accepted the same
  command twice. An earlier occurrence with the same signature is run 43827942317
  (jobs 133185143290 / 133185143410 / 133185143550).

  **Root cause, settled 2026-11-16 after ~4 h: Railway answered its own
  upload-initiate request with a non-JSON body, intermittently. Nothing in this
  repo, this credential or this CLI version decides it.** (What does decide it is the
  environment named on the call — see the second episode below, which also corrects the
  duration bound this paragraph first relied on.) The failure is in the
  pre-flight window — no `Indexing...` line, no archive, no deployment row — which
  is what made it look like a bad token. It is not. Each candidate was measured:

  | candidate | what measuring it showed |
  |---|---|
  | the secret's value | the **re-minted** token failed the same way at 16:12, 21 s after the same secret completed an upload in the **same job**; both red legs printed it masked at length 50 |
  | token scope | two read-only CI lanes pass with it; `railway status --environment staging --json` returned 40,632 bytes of JSON from the runner; raw `curl` to the API answered `HTTP 200, 53 bytes` |
  | CLI version | the identical failing command exited 0 in **3611 ms on 5.40.1** and **3448 ms on 5.74.1** in one job (run 43905428515); local 5.71.0 wrote staging `backend` `d3bfd45e` SUCCESS at 15:29 |
  | `CI=true`, the runner image, linux/x86_64 | a container with all three present behaved identically to the runner |
  | upload shape | staging `frontend-web`'s pathless repo-root upload succeeded from CI (`7f7efc20` SUCCESS, `configFile=/frontend-web/railway.json`, then HTTP 200 serving the `Loading Spotlight` literal) and staging `backend`'s `--path-as-root` succeeded minutes later |
  | tree size | 211,126,634-byte checkout / 133,423,024-byte archive uploaded fine; a 6-byte archive failed for its own unrelated reason |
  | `environment: staging` protection rules | none configured; a probe job declaring the same environment produced both outcomes |
  | connected git source | raised mid-investigation and dropped as "**not supported**": staging's three instances do carry `source.repo = paymax2022/spotlight-latest1` (re-measured 2026-11-17 with `railway api serviceInstance(serviceId, environmentId) { source { repo } }`: staging's is that repo, development's `repo` is `null`, production's whole `source` is `null`) while staging then accepted six uploads at 16:45-16:47 and twelve more at 17:01-17:06. **That dismissal does not hold.** Six acceptances with the source connected show the source is not *sufficient* to refuse an upload; they say nothing about whether it is *necessary*, and `--environment staging` is the only variable that has ever separated a refused call from an accepted one. It stays on the list as the surviving candidate, and it is narrower than "the staging environment": the property is per-instance, since staging's own Redis instance reports `source.repo = null`, so the three instances carrying a repo are exactly the three that refuse. The ask is written up in `railway-upload-fault-report.md` |
  | request rate | staging accepted two uploads 3 s apart at 16:34:47 / :50 and refused the next one 62 s later, which no per-minute quota fits |
  | in-flight concurrency (a pile-up of upload-initiates) | **tested and not supported.** Run 43913775480 made the identical staging `backend` call twelve times inside one job, so the fault window cannot differ between halves: six strictly one after another (17:01:06-:52, 3-4 s each) and six fired within 5 s of each other (17:02:59-17:03:04, 4 s each; the six deployment rows are `ab-C1`-`ab-C6`). **All twelve were accepted.** A cap of ~3 would have refused three of the six. Pile-up shape only *looks* predictive, because every CI leg in this repo piles up by construction — three matrix legs launched together — so a time-boxed fault that hits CI will always arrive wrapped in concurrency |

  Timing separates an accepted call from a refused one — 400 ms, 452 ms, 500 ms, 1151 ms,
  2526 ms, 2554 ms, 3448 ms, 3611 ms and 15738 ms for the same call shape across three
  hours, sub-second when the request is refused, seconds-to-minutes when it is accepted,
  because a refusal is an immediate non-JSON answer rather than a timeout. Read as a
  *diagnostic* that holds: a `railway up` that dies in under a second and prints no
  `Indexing...` line never reached the archive. Read as a *cause* it was wrong, and it is
  the sentence that built the time-boxed-window model this section now corrects — the
  durations below are per-call latencies, not a window with a length. The draft of this section asserted the secret held "a stray
  newline or a truncated paste". That was a guess, and reproducing each candidate
  corruption against the live staging environment with a known-good token disproves
  it — none of these shapes produces a decode error:

  | defect introduced | CLI result |
  |---|---|
  | none (valid token, correct environment) | success |
  | valid token, **wrong environment** | `Unauthorized. … valid and has access to the resource you're trying to use` |
  | one extra leading character | `Unauthorized. …` (same message) |
  | trailing newline | `Login state is corrupt. Please logout and login back in. Caused by: failed to parse header value` |
  | leading space | success — the CLI trims it |

  What the chain lacked was tolerance, not a credential. `railway up` was a
  single-shot call under `set -e`, so one upstream refusal reddens every staging leg —
  and because `smoke-staging` is the gate on production, it blocks production too.
  **#1044 routes the upload through the repo's existing `scripts/ci/with-retry.sh`**,
  the same answer already used for Docker Hub degradation, with
  `scripts/ci/test-railway-deploy-retry.sh` pinning both the retry and its bound
  against a stub CLI. Its budget is not arbitrary: the deploy script now defaults the
  upload call to **9 attempts from a 60 s base**, which is 900 s of guaranteed sleep
  before it gives up, and the test recomputes that sum from the script's own defaults
  and fails if it drops below the 883 s the fault was measured at.

  **Retry is necessary and, measured, NOT sufficient.** Run 43909191817 ran release.yml's
  three staging legs from #1044's tree with the wrapper live: every leg exhausted all
  four attempts — **twelve consecutive refusals between 16:35:47 and 16:38:15Z** — and all
  three jobs still failed. Four attempts on a 15 s base cost 105-157 s of backoff
  (`with-retry.sh` doubles 15 → 30 → 60 and adds up to half again), and the fault outlasted
  the whole budget. The window is also narrow in wall-clock terms, not just wide: staging
  `backend` accepted the identical upload at 16:34:50 and was refusing it 62 s later.
  So #1044 removes a single-shot halt; it does not, on its own, make `push → production`
  dependable, and it must not be merged on the claim that it does. Every structural
  candidate is now measured out — token, CLI version, upload shape, tree size, protection
  rules, request rate, and as of run 43913775480 the arrival pattern of the calls
  themselves — with one survivor, the connected git source, whose dismissal above does not
  hold. What is left is a fault on Railway's side with no predicate this
  repo can observe and only one measured bound on its duration: **every staging call CI
  made between 16:23:32 and at least 16:38:15 was refused — a stretch of fifteen minutes —
  while the entire 16:45-17:03 sample accepted everything.** "Continuously" would overstate
  it: the 16:34:47 / :50 probe acceptances above sit *inside* that span, so the fault is
  per-call and stochastic, with a duty cycle for the staging upload path that swings from
  ~0 to ~1 over tens of minutes rather than a window with a length. That is why no budget
  can be sized from this number: at duty ≈ 1 the calls come back refused however far apart
  you space them. A four-attempt, 105-157 s budget is
  therefore known, from this incident's own data, to be smaller than the shortest window it
  has to survive, and #1044 was resized to 900 s of guaranteed backoff against that bound.
  The bound was a floor and not a ceiling, and it was measured by hammering one environment:
  it says staging refused for at least 883 s, not that any refusal lasts 883 s. Nothing about
  the fault is bounded by anything in this repo, and the definitive fix is Railway's.
  `max-parallel: 1` is dropped as a remedy — it was the mitigation the concurrency model
  implied, and the model failed its test — not because serializing legs is harmful, but
  because nothing measured says it would have helped.

  **#1044 has since been run against the live fault and lost, which retires "size the
  budget" as a strategy.** Run 43972239504 (`4d78ecf69` — the merge that carried #1044)
  cleared the gate, deployed all three development legs green, then took 9/9 refusals on
  every staging leg: first refusal 23:18:25.2, last 23:38:48.1. **All 27 staging calls in
  that span were refused and none had succeeded when the retry gave up** — and none created
  a deployment row: queried 2026-11-17 00:10Z, staging's three `latestDeployment` records
  still date from 15:56:15 (`e4670d96`), 16:11:27 (`d5825eff`) and 17:06:29Z (`28946ae4`),
  all `SUCCESS`. `smoke Staging`,
  `migrate production` and `deploy Production` were all skipped, and the next morning
  production still served the hand-uploaded `5d3cc42eaff4c922` / `a40c84d670c40bb6`. That
  is not a fault a longer sleep covers, because it is not keyed to the clock — it is keyed
  to the upload target, and the same run proves it inside eleven seconds:

  | 23:18Z | event |
  |---|---|
  | :16.4 | development `frontend-web` begins its upload POST |
  | :17.2 | development `frontend-admin` upload **accepted** |
  | :19.7 | development `backend` upload **accepted** |
  | :25.2 | staging `frontend-admin` attempt 1 **refused** — same project, runner, CLI, SHA |
  | :27.5 | development `frontend-web` upload **accepted**, its POST having spanned the refusal above |
  | 23:38.5 | staging `frontend-web` attempt 9 refused, fault still live |

  One accepted request's own round trip contains a refused one. Railway is answering
  differently for `--environment staging` than for `--environment development` in the same
  second; both of this incident's episodes have that shape (the 16:23 table above is the
  same fact, seen earlier and read as timing). The most recent staging upload known to have
  succeeded — deployment `28946ae4`, `cliMessage f7d1ac27…-serial2-i3`, 17:06:29Z —
  used the same re-minted secret and the same `--path-as-root` shape that is refused now.
  Three consequences are written down so nobody re-derives them. **Do not raise
  `RETRY_ATTEMPTS` again from this section**: the 900 s already costs each staging leg
  18-21 minutes of runner before it fails, and there is no upper bound left to measure
  against.
  **`test-railway-deploy-retry.sh`'s 883 s assertion is a floor, not a certificate** — it
  catches a budget collapsing back toward single-shot and says nothing about sufficiency,
  which is also what `THE UPLOAD BUDGET` in `railway-deploy.sh` claims. **A green
  development leg is not evidence that staging will take the same bytes.** What remains is
  to hand Railway the differential above (`railway-upload-fault-report.md`) and to decide
  whether an upload their staging API refused — which created no deployment and therefore
  tested nothing about the artifact — should keep holding production hostage at all. That is
  a release-policy decision for the owner, not an edit to this file.

The second live hazard found while chasing F2 is not a chain defect but produces the
same red: a concurrent session kept hand-running staging `frontend-web` with the
pre-#1040 app-folder shape at 15:39–15:58, which yields FAILED rows with
`configFile=null` and no build (`23530ea0`, `60276288`, `70ff3429`, `74a561e3`). Those
rows look identical to an F2 casualty in a deployment list. Nobody may hand-upload
staging while the chain is live; if a staging leg is red, read `meta.configFile`
first — `/frontend-web/railway.json` means the shape was right and the failure is
elsewhere.

Because F2 blocked `deploy-production`, production's two frontends were written by
hand on 2026-11-16 from `ef97ec64b` (`origin/main`) —
`frontend-admin` deployment `616bd93b`, `frontend-web` deployment `ea71b561`, each
uploaded as `railway up <folder> --path-as-root --no-gitignore --message main-<sha>-prod-*`
from a worktree whose tracked `frontend-admin/` and `frontend-web/` trees diff empty
against that commit. This is an **exception**, not a new path: it is the same manual
write that checklist item 2 exists to forbid. It stops being necessary when a
push to main completes `deploy Production (*)`, which needs #1044 merged and has
never yet been executed — `RAILWAY_TOKEN_PRODUCTION` is validated *read-only* from CI
(run 43905428515 listed production's real deployment history in 628 ms), but the
production upload itself has never run from CI. Read the probe contract below before
believing either deployment.

## Railway project tokens: scope, minting, inventory — measured 2026-11-16

**A project token is scoped to exactly one environment.** Each recoverable CI token
was run against all three environments with
`railway service list --environment <env> --project e7dca861-… --json`, and the
result is a clean diagonal — a staging token is refused in development and production,
and vice versa:

| preview (last 4) | minted for | development | staging | production |
|---|---|---|---|---|
| `…xU87` | staging | Unauthorized | **OK (4 services)** | Unauthorized |
| `…keiY` | production | Unauthorized | Unauthorized | **OK (4 services)** |
| `…wtix` | development | *not testable — the only on-disk copy of this value is corrupted; the secret works, because development's deploy legs succeed* | — | — |

This is why the retired `staging-Old` row below matters, and why a token that "works
locally" proves nothing about CI unless it is the *same value* and the *same
environment*. These three are the **2026-11-14** values, measured before today's
re-mint; `…wtix` is still what `RAILWAY_TOKEN_DEVELOPMENT` holds, while staging and
production have since moved to fresh tokens whose binding is proven in the table below.

**Minting and revoking tokens is dashboard-only; listing is not.** With the CLI's own
credential (an OAuth user session for `spec.ng@gmail.com`), both `projectTokenCreate`
and `apiTokens` answer `Not Authorized` / `INTERNAL_SERVER_ERROR`, and `railway` has no
`token` subcommand — so nothing in this repo, and nothing an agent holding the CLI
session, can rotate these credentials. Creating or revoking one requires a logged-in
web session on the project's Tokens page. That is the sense in which F2 was an operator
action. Read-only enumeration *is* available to the same session through
`projectTokens(projectId:, first:)` — which is how the inventory below was taken, and
how the count of live credentials is auditable without a dashboard visit.

**Correction, measured 2026-11-16 at 17:06Z:** an earlier draft of
this section recorded the 15:08Z secret replacement as installing the *2026-11-14*
values. It did not. `projectToken` was queried from CI with each of the three secrets
as `RAILWAY_TOKEN`, and Railway answered directly — no upload, no deploy, no variable
write, and `displayToken` deliberately left out of the document:

| secret | token `name` | `projectId` | `environmentId` | `createdAt` |
|---|---|---|---|---|
| `RAILWAY_TOKEN_STAGING` | `staging` | `e7dca861-…` | `6b5f27a3-…` = **staging** | **2026-11-16 15:00:11Z** |
| `RAILWAY_TOKEN_DEVELOPMENT` | `development` | `e7dca861-…` | `87489af5-…` = **development** | 2026-11-14 19:42:54Z |
| `RAILWAY_TOKEN_PRODUCTION` | `production` | `e7dca861-…` | `f84c4558-…` = **production** | **2026-11-16 15:04:37Z** |

So staging and production really were re-minted today and really do carry today's
values, each pinned to the environment its variable is named after. Production's
secret is now known-good *without* a production write — which is the most that could
be proven short of the thing itself. **Re-minting still did not fix F2**: the staging
legs failed again at 16:12 with these exact values in place, part of the exoneration
above. Fresh tokens remain worth doing on their own merits (see the plaintext note
below), not as a fix for a fault that is not in the credential. The 15:08Z secret
replacement is still worth recording as an incident of its own: deleting and re-adding
left both secrets absent for twenty seconds (15:08:11 → 15:08:31Z). No deploy ran in
that window, so nothing failed for that reason — but a chain that had run then would
have died on an empty token, not on F2.

**Inventory** — `projectTokens(projectId: e7dca861-…, first: 50)`. `displayToken` is
Railway's own masked preview (first 10 and last 4 characters), so these strings carry
no secret:

| created | token `name` | environment it is bound to | preview | status |
|---|---|---|---|---|
| 2026-08-10 | `github-actions-development` | development | `0aba-****-9e10` | superseded 2026-11-14, still alive |
| 2026-08-10 | `github-actions-production` | production | `0370-****-5c0c` | superseded 2026-11-14, still alive |
| 2026-08-10 | `github-actions-staging` | **staging-Old** | `838e-****-7088` | bound to the environment retired 2026-11-16; can only ever fail |
| 2026-11-14 | `development` | development | `rlwy_proj_****wtix` | in `RAILWAY_TOKEN_DEVELOPMENT` since 2026-11-14 |
| **2026-11-16 15:00:11** | `staging` | staging | `rlwy_proj_****FCjl` | **in `RAILWAY_TOKEN_STAGING`** — today's re-mint |
| **2026-11-16 15:04:37** | `production` | production | `rlwy_proj_****zr4I` | **in `RAILWAY_TOKEN_PRODUCTION`** — today's re-mint |

Two things changed with the re-mint. Both 2026-11-14 project tokens were revoked —
including `…xU87`, confusingly *named* `development` while bound to the staging
environment — so they no longer appear in this list, and their replacements carry
names that agree with their `environmentId`. **The doctrine still holds: read `environmentId`,
never `name`** — that mislabeled token is exactly the failure it guards against, and it
sat in CI for two days doing its job correctly while its label said something else.
Revoking the three superseded 2026-08-10 tokens remains a dashboard action and has
**not** been done, so six project tokens are live: three in use and three dead weight,
one of which can only ever fail because its environment no longer exists.

**The plaintext values sit in `backend/.env`, and were never committed.** The
2026-11-14 values were pasted there at `STAGING_RAILWAY_TOKEN`,
`DEVELOPMENT_RAILWAY_TOKEN` and `RPRODUCTION_AILWAY_TOKEN` — the second two key names
are themselves mis-typed, and the development value has a doubled leading character
(51 chars where the working format is 50), which is why that particular copy fails.
`.gitignore:11` ignores `.env`, `git ls-files backend/.env` does not list it, and
`git cat-file -e origin/main:backend/.env` fails, so the tokens are not in history.
Today's re-mint shrinks the exposure but does not close it: both 2026-11-14 copies in
that file (`…xU87` for staging, `…keiY` for production) have been **revoked** and no
longer appear in the inventory above, so those two lines no longer buy an attacker
anything. The development copy is different — the
corruption is a single doubled leading character, which anyone holding the file can
undo by hand, so `…wtix` must still be treated as disclosed. Revoking it and deleting
all three lines from the file is the remaining work; CI needs no new value to do it,
because revoking development's token and minting one replacement is one dashboard
action plus one `gh secret put`.

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
