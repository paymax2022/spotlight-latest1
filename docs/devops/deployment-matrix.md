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
| `frontend-web` (Next.js) | cPanel Passenger (`spotlightng.com`) | Railway (`frontend-web-staging-new`) | **Prod:** push to `main` here → `sync-frontend-web.yml` ("Spotlight Frontend Web Safe Merge", gated on `vars.SPOTLIGHT_FRONTEND_SYNC_ENABLED`) copies `frontend-web/` into `paymax2022/spotlight-latest` `main` → **that repo's** ungated `Deploy to Namecheap cPanel (SSH)` lane builds, rsyncs, purges `.next/server/route-cache` and restarts Passenger — so a `main` push IS a production release. This repo's own `deploy-cpanel.yml` stays inert (`vars.CPANEL_DEPLOY_ENABLED` unset, secrets absent) and is not the writer. **Staging:** Railway native git deploy from the `staging` branch | `sync-frontend-web.yml:48` (destination repo), `spotlight-latest` Deploy-to-cPanel runs green on every sync (latest 2026-11-11), `deploy-cpanel.yml` header, `frontend-web/server.js`, `frontend-web/railway.json`, `eas.json` staging API URL |
| `backend` (Go API) | Railway `production` service `backend` (`backend-production-1b33d.up.railway.app`) | Railway `staging` service `backend` (`backend-staging-new.up.railway.app`) | `ci.yml`'s dispatch-only `deploy-{development,staging,production}` jobs `railway up` the folder — no push deploys it. GCP Cloud Run is the **intended** target of `.github/workflows/deploy.yml` (sha-tagged image → staging → 10% canary → human-gated promotion), but every one of its jobs is skipped while `vars.GCP_PROJECT_ID` is unset | live `GET /api/v1/public/health` 200 on both Railway hosts and `NXDOMAIN` for `api.spotlightng.com`; `deploy.yml:34` gate, 100/100 `skipped` runs in its history; `infra/terraform/cloud-run.tf`. **Serving binary measured 2026-11-14** — `curl -s https://backend-production-1b33d.up.railway.app/api/v1/public/build` → `{"commit":"585bd2ca7fab5c0a5adf9e67ab40b04068e9cee0","source":"ldflags","started_at":"2026-11-13T09:48:09Z"}` (staging, read the same minute, answers `2a82a62ef…` — the same commit as its `origin/staging` tip at that reading). `585bd2ca7…` is the tip of `origin/chore/promote-prod-module-readiness` (PR #996) and is **not an ancestor of `origin/main`** (`git merge-base --is-ancestor` → false); against the pin below it is 7 commits ahead-side / 713 behind (`git rev-list --count` both directions). **PENDING, NOT DONE — the release-SHA cutover:** nothing in this plan has deployed, dispatched or pushed this service. Bringing prod to `RELEASE_SHA c49b395643473ba6ff7a225d7a7a339a41eddfe6` is **Task 11**, still open, and ledger §10.6 requires re-reading `/api/v1/public/build` at execution time instead of quoting any figure stored in a doc — including the one above. |
| Backend workers (asynq) | Render `spotlight-notification-worker` | Render | `render.yaml` worker service (AUD-INFRA-006). Not deployed by `release.yml` — see "notification-worker version state" below. | `render.yaml` |
| `frontend-admin` (Next.js) | `admin.spotlightng.com` (cPanel) | Railway (`frontend-admin-staging-new`) | cPanel Passenger host; `frontend-admin/railway.json` for staging | `backend/internal/config/config.go` `ADMIN_APP_BASE_URL` default, `frontend-admin/railway.json` |
| `mobile-app/reactnative` | EAS `production` profile | EAS `staging`/`preview` profiles | `eas build -p android --profile <p>`; store distribution out of band | `mobile-app/reactnative/eas.json` |
| Postgres + GoTrue | Supabase cloud | Supabase cloud (shared project) | **`db-migrate.yml` is NOT dormant** (corrects the earlier "dormant by design (AUD-INFRA-005)" claim, which was false). Measured 2026-11-14: it triggers on `push` to `branches: [main, staging]` with paths `supabase/migrations/**` **and** its own file (`db-migrate.yml:40-43`), and its `apply` job runs when `(workflow_dispatch && target=='production') \|\| (push && ref=='refs/heads/main' && vars.DB_MIGRATE_ENABLED=='true')` (`:79-81`) under `environment: production` (`:83`), **which has required reviewers** — measured 2026-11-14: `gh api …/actions/runs/<parked run id>/pending_deployments` returns the deployment parked on environment `Production` with a populated `reviewers` array of two `User` entries and `wait_timer: 0` — the run ids themselves are held once, in ledger §16.2 item 1, which owns them. (An earlier draft of this cell called that fact "unconfirmed" because `…/environments/Production/deployment_protection_rules` reads `[]`; that endpoint lists *custom* protection rules such as wait timers, not required-reviewer rules, so `[]` is the expected answer and proves nothing. `pending_deployments[].reviewers` is the field to read, and it names who can approve.) Both switches are on today: `gh api …/actions/variables` → `DB_MIGRATE_ENABLED=true`, `DB_MIGRATE_STAGING_ENABLED=true`. So three lanes can write the DB — `db-migrate.yml` (gated by `Production`'s required reviewers, and one of its runs was parked when measured), `ops-db-push.yml` (manual, same gate, also parked at that reading) and `ops-db-push-scoped.yml` (`environment: production-db-scoped`, whose 2026-11-12 run was not parked at all, and it refuses the staging ref) — plus the bare `supabase db push` of the reconciliation runbook. `gh api …/actions/runs?status=waiting` and `status=pending` were both re-run on 2026-11-14: two writes sit parked on the `Production` gate and one further run had not reached an environment job. Their ids, heads and timestamps are recorded once — ledger §16.2 item 1 owns them, so this table deliberately does not repeat them (a fourth copy of a live run state is a fourth way to be stale). **Nothing in this plan approved, declined, dispatched or pushed any of them.** | `docs/devops/cloud-migration-reconciliation-runbook.md`; ledger §1.3-§1.4, §5.7, §16 |
| Redis / asynq broker | Render `spotlight-redis` | same | `render.yaml` service | `render.yaml` |
| `release.yml` | **Pending — lands in PR B (`feat/release-yml-auto-deploy`)** | Every push to `main`, plus `workflow_dispatch` for rollback | development, staging, production (Railway) | Declared here FIRST per the checklist below. Until PR B merges this writer does not exist and no workflow deploys on a `main` push. |

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
| `.github/workflows/deploy-railway-action.yml` | Optional manual alternative to the `ci.yml` dispatch jobs, using the `bervProject/railway-deploy` action. Installed dark behind `vars.RAILWAY_ACTION_DEPLOY_ENABLED` (unset); enabling it creates a second Railway writer, so keep it off unless intentionally replacing the `ci.yml` path. |
| `mobile-app/reactnative/vercel.json` | For the Expo **web export** preview, not native builds. |

## Promotion model

**Retired 2026-11-15.** There are no promotion branches in the release path any more.

A push to `main` is the release. `release.yml` waits for that commit's CI to go
green, then deploys development (non-blocking) and staging → production
(sequential, each environment's database migrated before the code that needs it,
nothing reaching production until staging has been probed and is serving the new
commit). There is no `workflow_dispatch`, no typed `DEPLOY` confirmation, no
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
"Verified current state") found **no content on either branch that `main`
lacks**. `git cherry` marks eleven commits `+` (re-run 2026-11-15 after Task 1:
seven on `prod`, four on `staging`), but a `+` means the *patch-id* was
not found upstream — it does not mean the content is missing. Five are already on
`main` in full; five are cases where `main` has moved ahead and merging would
revert it; one resurrects a deliberately deleted workflow.

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

## Reconciliation checklist (when adding a deploy path)

1. Declare the service's row here FIRST, marking the old path's status.
2. One path per service per environment — never two live writers.
3. The canary/probe contract is `/healthz` + `/readyz` (AUD-INFRA-007).
4. Migrations are applied BEFORE traffic via the additive-only chain
   (AUD-INFRA-005 tracks automating this).
