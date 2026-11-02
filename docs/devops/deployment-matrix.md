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
| `frontend-web` (Next.js) | cPanel Passenger (`spotlightng.com`) | Railway (`frontend-web-staging-new`) | `.github/workflows/deploy-cpanel.yml` on push to `main` (prod) — currently inert, gated on `vars.CPANEL_DEPLOY_ENABLED`, see Promotion model; Railway native git deploy from `staging` branch (staging) | `deploy-cpanel.yml`, `frontend-web/server.js`, `frontend-web/railway.json`, `eas.json` staging API URL |
| `backend` (Go API) | Railway `production` service `backend` (`backend-production-1b33d.up.railway.app`) | Railway `staging` service `backend` (`backend-staging-new.up.railway.app`) | `ci.yml`'s dispatch-only `deploy-{development,staging,production}` jobs `railway up` the folder — no push deploys it. GCP Cloud Run is the **intended** target of `.github/workflows/deploy.yml` (sha-tagged image → staging → 10% canary → human-gated promotion), but every one of its jobs is skipped while `vars.GCP_PROJECT_ID` is unset | live `GET /api/v1/public/health` 200 on both Railway hosts and `NXDOMAIN` for `api.spotlightng.com`; `deploy.yml:34` gate, 100/100 `skipped` runs in its history; `infra/terraform/cloud-run.tf` |
| Backend workers (asynq) | Render `spotlight-notification-worker` | Render | `render.yaml` worker service (AUD-INFRA-006) | `render.yaml` |
| `frontend-admin` (Next.js) | `admin.spotlightng.com` (cPanel) | Railway (`frontend-admin-staging-new`) | cPanel Passenger host; `frontend-admin/railway.json` for staging | `backend/internal/config/config.go` `ADMIN_APP_BASE_URL` default, `frontend-admin/railway.json` |
| `mobile-app/reactnative` | EAS `production` profile | EAS `staging`/`preview` profiles | `eas build -p android --profile <p>`; store distribution out of band | `mobile-app/reactnative/eas.json` |
| Postgres + GoTrue | Supabase cloud | Supabase cloud (shared project) | `supabase db push` — manual; `db-migrate.yml` is dormant by design (AUD-INFRA-005) | `docs/devops/cloud-migration-reconciliation-runbook.md` |
| Redis / asynq broker | Render `spotlight-redis` | same | `render.yaml` service | `render.yaml` |

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

- A Railway env is written to only by `ci.yml`'s three dispatch jobs
  (`deploy-development` `:458`, `deploy-staging` `:543`, `deploy-production`
  `:683`). Each requires a manual `workflow_dispatch` carrying
  `inputs.confirm_deploy == 'DEPLOY'`, a branch test (`develop` / `staging` /
  `prod`) and `vars.RAILWAY_DEPLOY_ENABLED == 'true'`, then uploads the folder
  with `railway up`. No push to any branch deploys a Railway env on its own.
- The live staging services (`backend`, `frontend-web`, `frontend-admin`) carry
  a Railway git source on `main`, so their current builds report
  `meta.branch: "main"` — staging runs `main`, not the `staging` branch. The
  branch test above says which branch a dispatch must be run *from*, not what
  the hosts track, so staging drifts behind `main` until someone re-deploys.
- Production is **not** deployed by any lane today.
  `deploy-cpanel.yml` runs on every push to `main` but is inert by design: its
  job is gated on `vars.CPANEL_DEPLOY_ENABLED == 'true'`, which is unset, so the
  run reports `skipped`. That gate is what the lane is supposed to do — it had
  been removed on 2026-10-28 (`1e1e44f45`), which is why every push since then
  carried a red deploy check: the job dies at the scp step with "can't connect
  without a private SSH key or password", because the five secrets it reads
  (`CPANEL_SSH_HOST/USER/KEY/PORT`, `DEPLOY_PATH`) exist at no level the job can
  see (it declares no `environment:`). It has never completed a successful run —
  0 successes in 843 runs — so `spotlightng.com` is updated by hand; read the
  workflow's own header before turning the lane on, since its build also has no
  production env to bake. The backend's `deploy.yml` canary → promote gate never
  runs either (`vars.GCP_PROJECT_ID` unset skips every job); the Railway
  `production` env was last written by a `prod` dispatch on 2026-10-17.
- Full CI gates run on `develop`, `staging`, `prod`, and `main`
  (AUD-TEST-003); `integration-verify.yml` (heaviest suite) additionally runs
  on pushes to `main` and all PRs.
- `.github/workflows/deploy-railway-action.yml` is an optional, manual-only
  alternative to the `ci.yml` dispatch jobs (bervProject/railway-deploy). It is
  installed dark: `vars.RAILWAY_ACTION_DEPLOY_ENABLED` is unset, so `ci.yml`
  remains the single live writer. Enabling that switch creates a second writer;
  see "one path per service per environment" below.

## Reconciliation checklist (when adding a deploy path)

1. Declare the service's row here FIRST, marking the old path's status.
2. One path per service per environment — never two live writers.
3. The canary/probe contract is `/healthz` + `/readyz` (AUD-INFRA-007).
4. Migrations are applied BEFORE traffic via the additive-only chain
   (AUD-INFRA-005 tracks automating this).
