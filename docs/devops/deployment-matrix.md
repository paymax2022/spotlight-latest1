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
| `frontend-web` (Next.js) | cPanel Passenger (`spotlightng.com`) | Railway (`frontend-web-staging-ec46`) | `.github/workflows/deploy-cpanel.yml` on push to `main` (prod); Railway native git deploy from `staging` branch (staging) | `deploy-cpanel.yml`, `frontend-web/server.js`, `frontend-web/railway.json`, `eas.json` staging API URL |
| `backend` (Go API) | GCP Cloud Run `paymax-backend` | GCP Cloud Run `paymax-backend` (staging env) | `.github/workflows/deploy.yml` — sha-tagged image → staging → 10% canary → human-gated production promotion | `deploy.yml`, `infra/terraform/cloud-run.tf` |
| Backend workers (asynq) | Render `spotlight-notification-worker` | Render | `render.yaml` worker service (AUD-INFRA-006) | `render.yaml` |
| `frontend-admin` (Next.js) | `admin.spotlightng.com` (cPanel) | Railway | cPanel Passenger host; `frontend-admin/railway.json` for staging | `backend/internal/config/config.go` `ADMIN_APP_BASE_URL` default, `frontend-admin/railway.json` |
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
| `mobile-app/reactnative/vercel.json` | For the Expo **web export** preview, not native builds. |

## Promotion model

- `develop` → Development env (Railway native mapping), `staging` → Staging,
  `prod` → Production env mapping where Railway is the host.
- `main` → production frontend via `deploy-cpanel.yml`; production backend via
  `deploy.yml`'s canary → promote gate (requires human environment approval).
- Full CI gates run on `develop`, `staging`, `prod`, and `main`
  (AUD-TEST-003); `integration-verify.yml` (heaviest suite) additionally runs
  on pushes to `main` and all PRs.

## Reconciliation checklist (when adding a deploy path)

1. Declare the service's row here FIRST, marking the old path's status.
2. One path per service per environment — never two live writers.
3. The canary/probe contract is `/healthz` + `/readyz` (AUD-INFRA-007).
4. Migrations are applied BEFORE traffic via the additive-only chain
   (AUD-INFRA-005 tracks automating this).
