# Auto-deploy release pipeline — design

**Date:** 2026-11-15
**Status:** Approved direction (reconcile-then-flip, new `release.yml` chain). Not started. **Revised after screening 2026-11-15:** the divergence that made Phase 0 a blocker turned out to carry no content `main` lacks, so Phase 0 shrank from two merge PRs to tags plus a written do-not-merge list. The revision is marked inline wherever it overturns an earlier conclusion. **Revised again after the flagged-item review, same day:** both items I had marked "the user must decide" turned out to rest on false premises. Production `frontend-web` on Railway is not an orphan — `eas.json:65` makes it the shipped mobile build's production API base — so Decision E is reversed and the service is in the matrix. `notification-worker` is not development-only — production runs it on Render — so it gets a new Decision H and a Phase 0 record step instead of an open question.
**Scope:** every push to GitHub `main` releases itself — development, staging and production — with no human approval step in the way. One new workflow owns the whole chain; `ci.yml` goes back to being CI-only. No application code changes, no schema changes.

## Goal

A commit merged to `main` reaches development, staging and production without anyone clicking approve, typing `DEPLOY`, or pushing a promotion branch. Each environment's database migration is applied by the same chain before the code that needs it, and production is never written until staging has been probed and is serving the new commit. The chain has one emergency brake (`vars.RAILWAY_DEPLOY_ENABLED`) and one rollback path (`workflow_dispatch` with a `ref`), because removing approvals removes the human who used to catch a mistake.

## Verified current state

**What already auto-deploys, and needs no change.**

- Production database migrations: `db-migrate.yml` applies on push to `main` when `vars.DB_MIGRATE_ENABLED == 'true'`, under `environment: production`. It already has a stale-ref guard ("Refuse a stale or unapproved ref") and `concurrency: db-migrate-${{ github.ref }}` with `cancel-in-progress: false`.
- Production `frontend-web` **for the customer domain**: `sync-frontend-web.yml` pushes to `paymax2022/spotlight-latest` `main`, and *that* repo's cPanel lane is ungated. `deploy-cpanel.yml` in this repo is inert — 0 successes in 843 runs, `vars.CPANEL_DEPLOY_ENABLED` unset, five secrets absent. This covers `www.spotlightng.com` only; the Railway production `frontend-web` that the mobile app reads is a different service and is **not** auto-deployed today (Decision E).
- `vars.RAILWAY_DEPLOY_ENABLED` is already `true`.
- **No GitHub Environment will pause the chain.** Measured 2026-11-15 via `GET repos/{o}/{r}/environments/{name}`: `development`, `staging` and `production` all report `reviewers: []`, `wait_timer: null`, `prevent_self_review: null`, `can_admins_bypass: true`. (`staging-Old` does not exist as an environment — it 404s; it survives only as a Railway environment name.) This matters because a reusable-workflow job that declares `environment:` inherits that environment's protection rules, so a reviewer left on `staging` would silently re-introduce the approval this change removes.
- **Two more lanes fire on a `main` push** and are not part of the release contract: `.github/workflows/ci-optimized.yml` (`name: CI (Zero-Billing Optimized)`) duplicates ci.yml's frontend jobs with `npm run lint || true` and deploys nothing, and a `security` workflow (CodeQL, gitleaks, govulncheck, npm audit, trivy) runs alongside. Neither is in `.github/required-checks.txt`. `deploy-cpanel.yml` also triggers on the push and reports `completed/skipped` — it is inert, as recorded above.

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

**What each environment actually serves.** Measured live 2026-11-15 by reading each backend's own `/api/v1/public/build` (the binary is stamped via `BUILD_COMMIT` + `-ldflags`, `source: "ldflags"`), then testing each served SHA with `git merge-base --is-ancestor <sha> origin/main`:

| Environment | Served commit | Ancestor of `origin/main` (`6199a6b57`)? | Process started |
|---|---|---|---|
| production backend | `5ab7c9cc0bf3d2b42aa43215fe5df9630dfbc421` | **no** | 2026-11-15T09:00:26Z |
| staging backend | `2a82a62ef158f61e984b9b40f4a268c50e5fa299` | **no** | 2026-11-14T20:54:20Z |
| development backend | `15975f64fde9c5b86f21eeedc2ada0c05d253393` | yes (stale, not diverged) | 2026-10-16T05:43:57Z — 30 days old |

`/healthz` answers 200 on all three. `/readyz` answers 200 on production and staging but **503 on development** — its DB pool is not reachable, so a smoke step that requires `readyz == 200` in development fails today, before any of this work. That is a pre-existing condition, and it is a second reason the development leg must not gate production (Decision F).

**The served commits are not ancestors of `main`, but nothing on them is missing from `main` — screened, not assumed.** `git rev-list --left-right --count origin/main...origin/prod` → `745	10`, and `...origin/staging` → `30	5`. `git cherry` marks **6 prod-only** and **4 staging-only** commits with `+`. A `+` means the *patch-id* was not found upstream — it does **not** mean the content is missing, and reading it that way was this design's first wrong conclusion. Every one of the 10 candidates was screened file by file: for each file the commit touches, compare its blob against `origin/main`, and where they differ, test whether the commit's own patch reverse-applies cleanly onto `main` (which proves `main` already contains it).

| Candidate | Date | Verdict | Evidence |
|---|---|---|---|
| `548d07c4b` pin `react-native-screens` | 2026-10-11 | already on `main` | 3/3 files reverse-apply clean |
| `dae77e90b` activate launch rails | 2026-10-15 | already on `main` | 3/4 identical; `backend/.env.example` — `main` is 99 lines ahead |
| `41c19ea2b` promote main→prod | 2026-10-17 | **must not land** | 18 of its files were **deleted on `main`** by `2e22dfa7f` (#808, KYC admin-escalation removal). Merging resurrects that whole plane |
| `5ab7c9cc0` telemedicine intake port (#1025) | 2026-11-15 | already on `main` | **9/9 files byte-identical** — this is the commit production serves |
| `616900caf` academy console (#1030) | 2026-11-15 | **must not land** | `main` carries the composite tuition model (`AcademyPricingKey`, `max_students`, `training_schedule`); the candidate still has the older `capacity`. Merging reverts it |
| `973b010cc` academy BFF plane (#1031) | 2026-11-15 | **must not land** | 43/46 identical; the 3 that differ are `main` being ahead — `referralRewards`, `estateDualControl`, `filmAcademyAssessment` flags, and `next ^16.4.0` → `^16.4.3` |
| `75482a43a` privacy policy page | 2026-11-04 | already on `main` | 3/4 identical + `Footer1.js` reverse-applies clean |
| `6948a6c49` gated staging deploy lane | 2026-11-04 | **must not land** | `staging-frontend-web-deploy.yml` is **absent on `main`**, deleted by `b5bc4480f` (policy: "deploy only to `main`, never staging"). Landing it re-creates two live writers for one service-environment pair |
| `95beea87f` login policy links | 2026-11-08 | already on `main` | 1/1 identical |
| `2a82a62ef` promote #1014 to staging | 2026-11-14 | **must not land** | backend files identical; `contracts/intake.openapi.yaml` + `contracts/openapi.yaml` — `main` is 601 lines ahead |

**So the rollback risk this design was built around does not exist.** Four candidates are already on `main` in full, five are cases where `main` has moved *ahead* and merging would revert it, and one resurrects a deliberately deleted workflow. Deploying `main` today does not roll production back over missing work — production's own served commit (`5ab7c9cc0`) has a touched-file set that is byte-identical to `main`.

**The residual risk is semantic, not genealogical.** Git screening proves no *commit* is missing; it cannot prove that where `main` reimplemented something differently, it covers every edge case the promotion-branch version did. That risk is retired by the probe contract in the Verification section — staging smoke before production — not by more archaeology.

**What Phase 0 is therefore for** is not porting content. It is stopping the divergence from misleading anyone again: `origin/prod` and `origin/staging` still point at commits whose file trees are *older* than `main`'s, so the next person who merges one of them "to catch up" resurrects #808's deleted KYC plane or reverts the academy tuition model.

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

Three facts here change the design:

- **Development `frontend-web` is red today.** Its latest deployment failed on 2026-11-13. If the chain treats a failed development deploy as fatal, every release halts on a pre-existing failure that has nothing to do with the commit being released.
- **Production `frontend-web` on Railway is not an orphan — it is the shipped mobile app's production API base.** `https://frontend-web-production-9259.up.railway.app/` returns 200 (85,258 bytes) and `https://www.spotlightng.com/` returns 200 (85,895 bytes), and their `/_next/static/chunks/` hashes differ, so they are two different builds. The customer domain does not read the Railway instance. **Two other production consumers do:** `mobile-app/reactnative/eas.json:65` sets the `production` profile's `EXPO_PUBLIC_API_BASE_URL` to exactly that host (`production-apk` at `:72` `extends: production`, so the APK inherits it), and `frontend-admin`'s production environment sets `WEB_API_BASE_URL` to the same host. That `eas.json` line is not an accident — commit `e8eae3ad6` ("fix(mobile): point eas production profile at prod Supabase + Railway BFF", 2026-10-06, an ancestor of `origin/main`) moved it there deliberately, describing the previous state as "split-brained". So the Railway instance is a *live production BFF that nothing in the release chain updates*.
- **Nothing automatic writes it today.** Its 2026-11-15 13:32Z deployment is not attributable to any workflow run: `ci.yml` has had **no `production` `workflow_dispatch` since 2026-10-17** (191 dispatch runs total; the most recent are `staging` 2026-11-14 and `prod` 2026-10-17), and `ci.yml`'s 2026-11-15 runs are all `push`/`pull_request` events, none of which can deploy. It was a hand-run `railway up`.

**`notification-worker` is a production service — on Render, not Railway.** The Railway service by that name exists only in development (SUCCESS 2026-11-01), and no file under `.github/` mentions it at all. Production runs it from `render.yaml:76-84` (`type: worker`, `name: spotlight-notification-worker`, `startCommand: /app/notification-worker`, `autoDeploy: true`), built by `Dockerfile:18`, and `docs/devops/deployment-matrix.md:16` lists "Backend workers (asynq) — Production: Render `spotlight-notification-worker`" as an **authoritative** row. It is load-bearing, not vestigial: the production Railway `backend` service does **not** set `RUN_WORKERS_INPROCESS` (measured from its production variable list, 2026-11-15) and `backend/internal/config/config.go:1234` defaults it to `false`, so the web service does not drain the queue in-process — `render.yaml:73-74` states the consequence: "Without this service every queued push/email/SMS sits in Redis forever."

Worker and web service share one compiled contract: `backend/cmd/notification-worker/main.go:28` registers its handlers through `notifications.Workers(mux, …)`, the same `backend/internal/notifications` package the web service enqueues from, and both binaries come from the same `Dockerfile`. So a release that ships a new web service to Railway while the worker binary stays at an older commit can enqueue payloads the old worker decodes incorrectly. Whether that skew exists today depends on whether Render's blueprint is still connected to this repo — **which cannot be verified from the repo**, and is a pre-flight check (Phase 0), not something the chain can own.

**Render's production *backend* web service is dead, and only that.** `render.yaml:5-21` still declares `spotlight-backend` with `autoDeploy: true` and `ENVIRONMENT: production`, but `https://spotlight-backend.onrender.com/` answers 200 with the body `Hello, world!` and `/healthz`, `/readyz`, `/api/v1/public/build`, `/api/v1/public/health` all answer 404 with an **Express** error page (`Cannot GET /healthz`) — not Go, not gin. So that hostname is a placeholder, not the production API; production `backend` is Railway `backend-production-1b33d` (verified serving `5ab7c9cc0`). `docs/devops/deployment-matrix.md:30` agrees: "Render was the backend host pre-Cloud-Run; the **worker + Redis services in the same file are still live**." The chain therefore does not need to consider Render's web service — but it must not assume Render is retired as a platform, because the worker and Redis rows are authoritative.

**Two Railway CLI facts that must survive the move.**

- A frontend service with a Railway `rootDirectory` must be uploaded with **no positional path and no `--path-as-root`** (`railway up .` dies "prefix not found"). Only `ci.yml`'s staging matrix does this correctly — `path: ''` / `root_flag: ''` for both frontends (`ci.yml:632-637`), `root_flag: --path-as-root` for backend only (`:622-624`), consumed by a templated `railway up ${{ matrix.path }} ${{ matrix.root_flag }}` at `ci.yml:659`. The same defect is hardcoded in **three** places: `ci.yml:563` (development), `ci.yml:790` (production), and `development-deploy.yml:98`. All three pass a positional path with `--path-as-root` regardless of the service.
- The CLI's default HTTP timeout is 90s, which truncates the 93 MB `frontend-web` upload. `RAILWAY_HTTP_TIMEOUT` must be set on every `railway up`.

**`ci.yml` concurrency can kill a deploy mid-upload.** `concurrency: group: ci-${{ github.workflow }}-${{ github.ref }}` with `cancel-in-progress: true`. Any deploy that lives inside `ci.yml` on `main` is cancellable by the next push. The new chain must not be. `integration-verify.yml` uses the same shape (`integ-${{ github.ref }}`, cancel in progress).

**Both CI lanes skip docs-only `main` pushes.** `ci.yml` and `integration-verify.yml` each declare `push: branches: [main]` with `paths-ignore: ['**.md', 'docs/**']`. So a docs-only commit produces no check-runs at all — which a naive "wait for green" gate would read as a 40-minute timeout.

**`ci.yml`'s header comment is stale and asserts a mechanism that does not exist.** It says "Railway performs native GitHub deployments from these branches after its per-environment branch mapping is configured: develop -> Development, staging -> Staging, prod -> Production." No such mapping is configured: every service in every environment reports `source: null` (measured 2026-11-15), so a branch push cannot deploy anything and `railway up` is the only route. The comment must be corrected when the deploy jobs move out, or the next reader will believe a push deploys.

## Decisions

**A. Retire the divergence, don't port it.** Screening found no content on `origin/prod` or `origin/staging` that `main` lacks, so Phase 0 is not a pair of merge PRs — it is resetting the two promotion branches onto `main` and recording the five commits that must never be merged back, with their reasons. It still happens *before* the auto-deploy switch is turned on, because until the branches are reset, a stale promotion commit sitting on `origin/prod` is a loaded gun pointed at `main`.

**B. One new workflow owns the chain.** `.github/workflows/release.yml`, triggered by `on: push: branches: [main]`. `ci.yml` loses its three deploy jobs and becomes CI-only. The alternative (keeping deploys in `ci.yml` and dropping the conditions) was rejected: it inherits a `cancel-in-progress: true` group, and it leaves the required-check names entangled with deploy job names that `scripts/ci/test-changed-modules.py` asserts on.

**C. The chain waits for CI rather than racing it.** `release.yml` polls until the commit's CI is green. *(Corrected during plan-writing: the original wording required a check-run named `integration-verify`, and no such check-run exists — measured against `6199a6b57`, that workflow produces check-runs named for its own jobs (`Association CI`, `Health CI`, `live-DB suites (Postgres + migrations)`, …), never one called `integration-verify`. Waiting on that name would have timed out on every release.)* So `gates` waits on two different things, by the right mechanism for each: every check-run name in `.github/required-checks.txt` (all nine verified present on `6199a6b57`), **plus the `integration-verify` workflow *run*** for that SHA reaching `completed/success`. A `skipped` conclusion satisfies. A `workflow_run` trigger was rejected: it means two triggers and two racing releases for one push, and it behaves wrongly on a rollback dispatch.

**D. One apply path per database, owned by the chain.** The apply logic is extracted into a reusable workflow called by `release.yml`; `db-migrate.yml` loses its `push` triggers. This is not only tidiness — today the staging apply fires only on a push to the `staging` branch, so a `main`-only release model would stop migrating staging altogether (Migration ownership). **One implementation constraint, found by probing rather than assuming:** a job that calls a reusable workflow with `uses:` **cannot declare `environment:`**. `actionlint` v1.7.12 — the exact version `ci.yml`'s `workflow-lint` job installs — rejects it outright: *"when a reusable workflow is called with `uses`, `environment` is not available. only following keys are allowed: `name`, `uses`, `with`, `secrets`, `needs`, `if`, and `permissions`"*. The Supabase credentials are **not all** repository-scoped, and the one that is not decides the shape: measured 2026-11-15 with `gh secret list --env <name>`, the `production` environment holds exactly one environment secret, `SUPABASE_DB_PASSWORD`, while `staging` and `development` hold none — `SUPABASE_ACCESS_TOKEN`, both project IDs and the staging password are repository secrets (`db-migrate.yml:83` and `:187` rely on `environment: production` / `environment: staging` to resolve them). So the caller cannot read production's password to pass it down, and keeping `environment: ${{ inputs.target }}` on the *called* job also preserves today's precedence exactly — GitHub resolves an environment secret over a repository secret of the same name, so the move cannot silently change which password production applies with. The working shape, verified green under the same actionlint: the **called** workflow's own job declares `environment: ${{ inputs.target }}` and resolves the per-target secret names itself (`SUPABASE_PROJECT_ID` for production, `SUPABASE_STAGING_PROJECT_ID` for staging), with the caller passing only `with:`.

**E. Production `frontend-web` joins the deploy matrix.** *(Reversed during review — the original wording excluded it as an orphan, and the evidence says otherwise.)* The customer domain keeps its own writer: `sync-frontend-web.yml` → `spotlight-latest` → cPanel, already ungated, untouched by this change. But the Railway `frontend-web-production-9259` instance is the production API base for the shipped mobile build (`eas.json:65`) and for `frontend-admin`'s production `WEB_API_BASE_URL`, and today **only a hand-run `railway up` writes it**. Excluding it would leave the change half-done: the mobile app's BFF would still have no automatic release path after "remove all manual approval" shipped. Including it does not create a third writer — there are already two builds in production, and this *replaces* the manual writer with the chain rather than adding to it. Nor is it new scope: `ci.yml`'s existing `deploy-production` matrix (`:763-768`) already carries `- service: frontend-web / path: frontend-web` alongside `backend` and `frontend-admin`, so the production deploy job this design replaces deploys that service today. **Excluding it would silently drop a service from the production release** while the stated change was only "remove the manual approval". The cost is stated plainly: from this change on, a push to `main` changes what that live production URL serves, without anyone typing `DEPLOY`. That is the same exposure the customer domain already has, and it is what was asked for.

**F. A development failure does not block the staging→production leg.** Development is a sibling branch off `gates`, not a predecessor. Two measured facts make a green-development requirement unshippable today: its `frontend-web` deployment FAILED on 2026-11-13, and its backend `/readyz` answers 503 because the DB pool is unreachable. A chain that required development to be green would halt every release on pre-existing failures unrelated to the commit being released. Development failures are reported loudly in the run and the job summary, and they fail the workflow's overall conclusion — but they do not gate production.

**G. A docs-only commit is a no-op release; a superseded commit never deploys.** `ci.yml` and `integration-verify.yml` both skip `**.md` and `docs/**` on a `main` push, and both cancel in progress per ref. `gates` reads those two behaviours rather than duplicating the filter: no CI run for the SHA ⇒ nothing to build, exit green as a no-op; a required check reported `cancelled` ⇒ a newer `main` commit owns this release, exit without deploying. Both inferences apply to `push` events only — on a `workflow_dispatch` rollback, a SHA with no CI run fails loudly instead of no-op'ing, because the operator asked for that specific commit. Details under Phase 1.

**H. The chain does not deploy to Render, and must not create a Railway production worker.** Production's asynq consumer is Render's `spotlight-notification-worker` (`render.yaml:76-84`, authoritative per `docs/devops/deployment-matrix.md:16`), a platform the Railway-based chain does not own. Two consequences. First, the chain ships a new `backend` web service to Railway production while the worker binary is shipped by Render from the same `Dockerfile:18` — so worker/web version skew is possible, and because both sides share the `backend/internal/notifications` task contract (`backend/cmd/notification-worker/main.go:28`), skew is a correctness risk rather than a cosmetic one. Second, the obvious "fix" is wrong: adding a `notification-worker` service to the Railway production environment would put **two** consumers on the same queue with the same `REDIS_URL`, double-delivering push/email/SMS. The chain therefore leaves the worker alone, and Phase 0 gains a pre-flight check that records which commit Render's worker is running. If that check finds it stale, the repair is a Render deploy (or retiring `render.yaml`'s worker and re-homing it), which is a separate piece of work and is not part of removing approvals.

## Phase 0 — retire the divergence (small, non-destructive)

Screening is done and its verdict is in the table above: **no content needs porting to `main`**. What Phase 0 does is make that verdict durable, so the five "must not land" commits cannot be merged back by someone reading `origin/prod` as "ahead of main".

1. **Tag the current heads** — `archive/prod-2026-11-15` on `origin/prod` (`973b010cc`) and `archive/staging-2026-11-15` on `origin/staging` (`2a82a62ef`). No `archive/*` tag exists yet. Cheap, additive, and it keeps every commit reachable and auditable whatever happens to the branches next.
2. **Record the five must-not-land commits with their reasons** in `docs/devops/deployment-matrix.md`, next to the row that says releases come from `main`: `41c19ea2b` (resurrects #808's deleted KYC escalation plane), `616900caf` (reverts the academy composite tuition model), `973b010cc` (reverts three feature flags and downgrades `next`), `2a82a62ef` (reverts 601 lines of OpenAPI contract), `6948a6c49` (recreates the deleted staging deploy lane).
3. **Leave the branch refs alone for now.** Resetting `origin/prod` and `origin/staging` onto `main` would make the divergence disappear, but it is a force-push to shared branches and it is not needed for safety once steps 1 and 2 exist — after Phase 1 nothing deploys from those branches, so their drift is inert. Retiring `develop` / `staging` / `prod` entirely is the follow-up decision already noted under Removed vs kept.
4. **Record which commit Render's production worker is running** (Decision H). Render dashboard → `spotlight-notification-worker` → latest deploy, note the commit and whether the blueprint is still connected with `autoDeploy: true`. This cannot be read from the repo and it is the one production component the chain will never touch, so its version has to be written down before `main` starts deploying itself. If it is connected, a `main` push already auto-deploys the worker and no skew is possible. If it is not, the worker is frozen at an older commit and that is a pre-existing gap to fix separately — recorded, not silently inherited.

**If the user wants the branches reset anyway**, that is an explicit, separately authorized force-push: `git push --force origin archive/prod-2026-11-15` first (so nothing is lost), then reset. It is not part of this design's default path.

**Done when:** both archive tags exist on the remote, and the must-not-land list is committed in the matrix document.

## PR sequencing

1. **Phase 0** — archive tags, the must-not-land list, the Render worker version record, and the new `release.yml` row in `docs/devops/deployment-matrix.md`. Docs and refs only; no workflow behaviour changes, so it is safe to land first and cheap to revert.
2. **Phase 1** — `release.yml` + `_reusable-db-apply.yml`, the `ci.yml` and `db-migrate.yml` trigger removals, the retirement of `development-deploy.yml`, and the two stale header-comment corrections.

Phase 0 is no longer a hard blocker on Phase 1's *content* — screening removed the rollback risk that made it one. It stays first anyway, because Phase 1 is the change that makes `main` authoritative, and the record of what must not be merged back into `main` should exist before `main` starts deploying itself.

**The first automatic release is the riskiest one, and Decision E is why.** Today production `frontend-web` serves a build put there by a hand-run `railway up`; the first chain run replaces it with a build of whatever `main` is at that moment, with nobody typing `DEPLOY`. That is the intended behaviour, but it is also the one production consumer that cannot be re-pointed quickly if the new build is wrong — a mobile store build carries its `EXPO_PUBLIC_API_BASE_URL` baked in at submission time. So the first run after merge is watched, not assumed: confirm the served chunk hashes actually changed, confirm the mobile app's login path still works against it, and keep the `ref=` rollback dispatch ready. Phase 0's step 4 record is what makes the Render worker's state interpretable during that watch.

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

**`gates`** polls for up to 40 minutes and requires two things, each by the mechanism that actually reports it:

1. Every check-run name in `.github/required-checks.txt` reaches `completed/success` — read from `GET repos/{o}/{r}/commits/{sha}/check-runs` **with `--paginate`** (an unpaged call produces a false all-green; this repo returns 50 check-runs for one commit).
2. The `integration-verify` **workflow run** for that SHA reaches `completed/success` — read from `GET repos/{o}/{r}/actions/runs?head_sha={sha}`, filtered to that workflow and to `event == "push"`. It has no single check-run name to wait on (Decision C).

What `gates` deliberately does **not** wait on, and why: the full per-SHA run census for `6199a6b57` is `CI — CLAUDE.md gates`, `integration-verify`, `CI (Zero-Billing Optimized)`, `security`, `Deploy to Namecheap cPanel (SSH)` (skipped), plus two `schedule`-triggered runs (`Utility intent sweep`, `Utility vend retry`, both skipped). Waiting on "every run for this SHA" would couple the release to scheduled sweeps that have nothing to do with the commit, and to `ci-optimized.yml` — a redundant lane that runs `npm run lint || true` and so asserts almost nothing. The release contract is the required checks plus `integration-verify`; whether `security` should also gate a production release is a real question and is flagged under Out of scope rather than decided silently here.

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
| production | `backend`, `frontend-web`, `frontend-admin` | `frontend-web` included per Decision E — it is the mobile build's production BFF (`eas.json:65`) and `frontend-admin`'s `WEB_API_BASE_URL`, and `ci.yml`'s production matrix already deploys it. The customer domain keeps its own ungated cPanel lane via `sync-frontend-web.yml`. |

`notification-worker` is absent from every row on purpose, not by oversight. Production's worker runs on **Render** (`render.yaml:76-84`), a platform this chain does not deploy to, and the Railway service of that name exists only in development. Adding a Railway production worker would put two consumers on one asynq queue and double-deliver push/email/SMS (Decision H).

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
| production | `backend-production-1b33d.up.railway.app` | `frontend-admin-production-5b0c.up.railway.app` | `frontend-web-production-9259.up.railway.app` |

Production `frontend-web` is probed like the others now that Decision E puts it in the matrix. Its smoke check additionally matters more than the others: it is the mobile app's API base, so a deploy that reports SUCCESS while still serving stale bytes breaks a store build that cannot be re-pointed without a new submission. The chunk-hash warning above is the only available signal, since a frontend build echoes no commit.

## Failure handling and rollback

- A red gate, a failed migration, or a failed staging smoke **stops the chain before production**. Nothing partial is written to production. A gate that ends because the commit was *superseded* exits without deploying but is not a failure — the newer run owns the release (Decision G).
- A failed Railway deploy leaves the previous deployment serving. Observed, not assumed: development `frontend-web`'s latest deployment is FAILED (2026-11-13) and `https://frontend-web-development.up.railway.app/` still answers HTTP 200.
- **A failed development deploy does not stop anything** (Decision F). It fails the workflow conclusion and the job summary says so, but the staging→production leg has already been running concurrently and completes on its own merits. This is the deliberate cost of removing approvals: a release can be green in production while the run is red in development, so the run page must be read, not just its overall colour.
- **Rollback:** `workflow_dispatch` with `ref=<prior SHA>`, plus `skip_gates: true` if that SHA's check-runs are past retention. Because migrations stay additive-only / expand-first, re-deploying an older commit is safe: the older code reads a newer-but-compatible schema. A rollback re-runs the same chain and smokes in the same order, with **one deliberate exception — it does not apply migrations** *(added during plan-writing: the original wording said a rollback migrates too, and that cannot work)*. A rollback checks out an *older* `supabase/migrations/` directory, and `supabase db push --linked` against a remote that already holds newer versions aborts with "remote migration versions not found in local migrations directory" — the exact failure `db-migrate.yml`'s stale-ref guard exists to prevent, and the reason that guard *fails* a dispatch rather than skipping it. Additive-only is what makes skipping safe: the newer schema already satisfies the older code, the same property the rollback relies on. So `gates` resolves whether the target SHA is `main`'s tip and the apply step no-ops with a notice when it is not. The no-op lives *inside* the migrate job rather than in its `if:`, because a skipped `needs:` dependency makes GitHub skip every job downstream of it — a rollback would then deploy nothing at all.
- The 40-minute gate budget bounds how long a release can hang waiting for CI before it reports failure rather than parking silently.

## Removed vs kept

**Removed**

- The `Production` required reviewers — *already done, 2026-11-15*.
- The dispatch / `confirm_deploy == 'DEPLOY'` / promotion-branch conditions on `ci.yml`'s three deploy jobs. Those jobs move out of `ci.yml` entirely, leaving it CI-only.
- `ci.yml`'s `deploy_environment` and `confirm_deploy` dispatch inputs go with them. `ci.yml` keeps `workflow_dispatch` (re-running CI against any branch is still useful) but with no deploy inputs, so a CI dispatch cannot express a release at all.
- The promotion-branch requirement (`github.ref == 'refs/heads/develop|staging|prod'`) as a *release* precondition. The branches themselves stay — Phase 0 step 3 deliberately leaves the refs alone rather than force-pushing shared branches, and after Phase 1 nothing deploys from them so their drift is inert. Retiring `develop`/`staging`/`prod` entirely is a later, separate decision and is not part of this change.

**Kept**

- `vars.RAILWAY_DEPLOY_ENABLED` as the brake.
- `development-deploy.yml`'s verified-from-main pattern — folded into the chain, then the file is retired.
- The cPanel production-web path (`sync-frontend-web.yml`).
- Every operator lane: `ops-*`, `*-module-flags`, signup codes, `sync-env-secrets`. These are not release steps and stay manual unless the user asks for a sweep.
- `.github/required-checks.txt` and its warning: renaming a job breaks every PR, and `scripts/ci/test-changed-modules.py` asserts those names still exist in `ci.yml`.

## Docs and local verification

Order matters — the matrix document is canonical and its own checklist says declare the row first.

1. Update `docs/devops/deployment-matrix.md` **first**, in the same PR as the workflow change. It is canonical ("When this matrix and a config file disagree, this file wins"), and four of its statements become false the moment `release.yml` merges:
   - The **Promotion model** section: "A Railway env is written to only by `ci.yml`'s three dispatch jobs (`deploy-development` `:458`, `deploy-staging` `:543`, `deploy-production` `:683`)… No push to any branch deploys a Railway env on its own." Both halves invert. Those three line citations were already drifting (the jobs now start at `:489`, `:580`, `:721`) and disappear entirely once the jobs move out.
   - The **`frontend-web` row** (`:14`): production is recorded as cPanel only, and the Railway `frontend-web-production-9259` instance appears nowhere in the authoritative table despite being the mobile build's production API base. It must be declared as its own row, because the matrix's own checklist item 1 says "Declare the service's row here FIRST, marking the old path's status" (`:88`).
     This is the one place where the design has to make a judgement call against a canonical rule, so it is stated rather than slid past: checklist item 2 is "One path per service per environment — never two live writers" (`:89`), and read by the letter, `frontend-web` in production would then have two. Read by the doc's own gloss it does not — when the matrix applies that rule it is always about **the same host**: `deploy-cpanel.yml` is rejected because "it would add a second writer *to the same host*" (`:68`), and `deploy-railway-action.yml` is kept dark because it would write *the same Railway services* `ci.yml` writes (`:80-84`). Here the two paths write different hosts to different consumers: cPanel serves browsers at `www.spotlightng.com`, Railway serves the mobile BFF and `frontend-admin`'s API base. Both rows must say so explicitly, name their own writer, and name the consumer — a reader who cannot tell them apart is exactly the failure the matrix exists to prevent. If the user reads item 2 as forbidding this outright, the alternative is Decision E's rejected branch: retire the Railway instance and re-point `eas.json`, which is a mobile store submission, not a CI change.
   - The **`backend` row** (`:15`): mechanism changes from `ci.yml` dispatch to `release.yml` on push to `main`.
   - The **workers row** (`:16`): add that the release chain does not deploy Render, and record the verified worker commit from Phase 0 step 4, so the next reader knows whether worker/web skew is possible.
2. Then `docs/launch/BRANCH-PROTECTION.md`, `docs/devops/DEPLOY-RUNBOOK.md`, and `docs/devops/production-migration-ledger.md`.
3. Correct the two stale header comments that now describe the opposite of the truth: `ci.yml`'s claim that "Railway performs native GitHub deployments from these branches", and `db-migrate.yml`'s recommendation to add `production` required reviewers (see Verified current state and Migration ownership).
4. Locally: `actionlint` on every changed workflow, and `scripts/ci/test-changed-modules.py` (it asserts every required-check name still exists in `ci.yml` — moving the deploy jobs out must not break that).
5. After merge: watch the first `main` push end to end and read each environment's served commit back from `/api/v1/public/build`. Do not report the release as successful on a green run alone.

## Out of scope

- **No development Supabase project exists** (only production and staging secrets are configured), so development stays on local/docker Postgres. The chain does not migrate a development database.
- `deploy.yml` (GCP) stays inert.
- **Whether `security` should gate a release is not decided here.** It runs on every `main` push (CodeQL, gitleaks, govulncheck, npm audit, trivy) but is not in `.github/required-checks.txt`, so `gates` does not wait on it. Arguably a production release should not ship over a red secret scan — but adding it to the release contract is also adding it to branch protection's territory, and it is not part of "remove the manual approval". Flagged, not folded in.
- **`ci-optimized.yml` is not retired here.** It is a redundant second CI lane on `main` that asserts almost nothing (`|| true`), so it burns minutes without adding safety. Deleting it is a separate cleanup; leaving it is harmless to the chain because `gates` does not wait on it.
- `deploy-railway-action.yml` stays dark. Verified it has **no callers** — the only two matches for its own name in `.github/` are its `name:` line and its `concurrency` group, so nothing invokes it. `docs/devops/deployment-matrix.md:34` records it as installed dark behind `vars.RAILWAY_ACTION_DEPLOY_ENABLED` (unset) and warns that enabling it "creates a second Railway writer". Leave it off; the new chain must remain the single writer.
- **`frontend-web-production-9259` is adopted, not retired** (Decision E, reversed during review). It is in the production matrix. What stays out of scope is the *other* direction — retiring it and re-pointing `eas.json`'s `production` profile at `www.spotlightng.com`. That is a mobile-release decision, not a CI one, and it would undo `e8eae3ad6`, which moved the profile off the cPanel host on purpose.
- **`notification-worker` is not adopted, and the Render plane is not touched** (Decision H). The chain deploys to Railway only. Out of scope: creating a Railway production worker (it would double-consume the queue), and re-homing the worker off Render. In scope and required: the Phase 0 step 4 record of which commit Render's worker is running, because the chain will never update it and the two binaries share the `notifications.Workers` task contract.
- **`render.yaml`'s dead `spotlight-backend` web service is not deleted here.** It answers with an Express `Hello, world!` placeholder, so it is already inert, and `docs/devops/deployment-matrix.md:30` says to retire it "only after confirming nothing points at it" — that confirmation is a separate cleanup, and deleting it in the same PR as the release chain would mix an infra change into a CI change.

## Recorded live state (as of writing)

- `origin/main` head: `6199a6b57`. The local `main` ref in the shared worktree is stale (`1835ad4de`) and must not be moved — other sessions work there. Publish via a feature branch off `origin/main` plus a PR; never push `main`.
- `Production` environment reviewers: removed.
- Parked `Ops DB Push` run `43723411971`: failed without executing. No production DB write occurred. Whether to re-dispatch it (`mode=push`, `confirm=PUSH`) is the user's call — it is a production database write and needs explicit authorization.
- Divergence: production serves `5ab7c9cc0` and staging serves `2a82a62ef`; neither is an ancestor of `main`, but the file-level screen found **no content on either branch that `main` lacks**. `origin/prod` head is `973b010cc`, `origin/staging` head is `2a82a62ef`, `origin/develop` head is `da665dcd0`. Phase 0 exists to make that verdict durable, not to port anything.
- Development backend serves `15975f64f` — an ancestor of `main`, but the process has been up since 2026-10-16, so development is 30 days stale rather than diverged. Its `/readyz` answers 503.
- Development `frontend-web`: latest Railway deployment FAILED (2026-11-13); the URL still serves 200 from the previous deployment.
- Production `frontend-web` on Railway (`frontend-web-production-9259`, deployed 2026-11-15 13:32Z) serves a different build from `www.spotlightng.com` — but it is **not** unread: `eas.json:65` makes it the mobile `production` profile's `EXPO_PUBLIC_API_BASE_URL`, and `frontend-admin`'s production env sets `WEB_API_BASE_URL` to it. That 13:32Z deploy came from a hand-run `railway up`, not a workflow: `ci.yml` has had no `production` dispatch since 2026-10-17, and all its 2026-11-15 runs are `push`/`pull_request`.
- Production asynq worker: **Render** `spotlight-notification-worker` (`render.yaml:76-84`, `autoDeploy: true`). The production Railway `backend` does not set `RUN_WORKERS_INPROCESS` and `config.go:1234` defaults it `false`, so the web service does not drain the queue. Whether Render's blueprint is still connected to this repo is **unverified** — not readable from the repo; Phase 0 step 4 records it.
- Render's `spotlight-backend` web host is a placeholder: `https://spotlight-backend.onrender.com/` → 200 `Hello, world!`, and `/healthz`, `/readyz`, `/api/v1/public/build` all → 404 with an Express `Cannot GET` page. Not the production API.
- Everything above was measured on 2026-11-15 and is restated here so a reader in a later session can tell what was observed from what was assumed. Re-measure before acting on it.
