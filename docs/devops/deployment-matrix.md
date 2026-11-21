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

## Production backend on the `prod` lineage (2026-11-21)

Rule 1 above, applied: `ci.yml` now has a second, **automatic** writer of the
production Railway backend, alongside the manual path it replaces.

| What | Value |
|---|---|
| Host | `https://backend-production-1b33d.up.railway.app` (project `spotlight-platform`) |
| Writer | `ci.yml` → `deploy-production-backend`, on a **green push to `prod`** |
| Decider | `scripts/ci/prod-ship-scope.sh` — ships when the push changed `backend/**` **or** when the commit reported by `/api/v1/public/build` builds a **different `backend/` tree** than the push. Same tree ⇒ no rebuild, whatever the sha. |
| Refuses | a push carrying `supabase/migrations/**` (production's schema is still a manual `ops-db-push.yml` apply, so rule 4 is unchanged) |
| Kill switch | `gh variable set PROD_BACKEND_AUTO_DEPLOY_ENABLED --body false` |
| Read-back | `scripts/ci/railway-smoke.sh` fails the job unless production echoes the deployed SHA |

The decider prints a `reason=` line, and reading it is how you tell a correct
`ship=false` from a wrong one. Every value is pinned by
`scripts/ci/test-prod-ship-scope.sh`:

| `reason=` | `ship` | what it means |
|---|---|---|
| `backend-changed` | true | this push touched `backend/**` |
| `backend-stale` | true | the push did not, but the commit production serves builds different `backend/` bytes — a forgotten manual upload, a failed deploy, or the merge that installed this gate |
| `range-unresolvable` | true | `github.event.before` is absent or unknown in this checkout (first push, force-push) — **fails open** |
| `prod-uncomparable` | true | production reports a sha this checkout cannot see (rewritten history, or a build from the other lineage) so the image cannot be compared — **fails open** |
| `already-serving` | false | production already reports this exact commit; a rebuild would restart identical bytes |
| `image-current` | false | a different sha, but `backend/` is byte-identical — a console-only or workflow-only push |
| `no-backend-change` | false | nothing the image consumes changed and the deployed image cannot be established as stale |

`image-current` is the row that makes the `backend/**` predicate mean something:
comparing shas instead of trees calls every push stale, because a new commit is by
definition a new sha, and production would restart for a comment edit.

Two things to know before reading a green check as "released":

- Every Railway service here reports `source: null`, so no branch push deploys
  anything by itself; the table's GCP/Cloud-Run row for `backend` describes
  `deploy.yml`, which triggers on `main` only. The production host that answers
  today is the Railway one, and `/api/v1/public/build` is the authority on which
  commit it is serving — not this document's history.
- `main` (via `release.yml`) and `prod` (via `ci.yml`) both write the SAME
  production environment, exactly as operators' hand-run `railway up` used to.
  Last successful deploy wins, and the read-back says which sha that was.

Measured on 2026-11-21, before this gate existed: production served `d3401f574`
while `prod`'s tip carried three merges it had never been given — `6f58f0b0a`,
`bb59c7129` (the referral-code uniqueness rule, which touches `backend/**`) and
`36ba52226`. That gap is what the decider's second condition closes.

## The first automatic deploy (2026-11-21, run `44918367765`)

Merging PR #1122 pushed `prod` to `b9c21b534`. Nobody ran anything after the merge.

| Time (UTC) | Event |
|---|---|
| 15:17:17 | squash lands on `prod`, push event starts the run |
| 15:17:32 | `ship-scope` reads `d3401f574…` from `/api/v1/public/build`, prints `ship=true` / `reason=prod-behind` |
| 15:31:14 | the last required lane closes and `deploy Production backend (automatic)` starts |
| 15:31:25 | `stamped backend/BUILD_COMMIT`, upload accepted on attempt 1 |
| 15:34:12 | new container up (`uptime_seconds` at read-back: 116) |
| 15:34:18 | `smoke PASS: backend/production` — job success, run success (12 success / 18 skipped / 0 failure) |

`/api/v1/public/build` reports `b9c21b534becfdfb3e0d5cceeeeac2790df16083`, and the
route that fix added answers on production: unauthenticated
`PUT /v1/admin/referrals/<id>/code` returns **401 `missing bearer token`**, while a
sibling path that does not exist returns **404 `No API route matches`** — the pair
that distinguishes "mounted, needs auth" from "not deployed". Note the method: there
is no `GET` on that path, so probing it with `GET` reads as a 404 and proves nothing.

The 14-minute gap between the merge and the deploy is the `needs:` bar (the slowest
lane was `live-DB suites`), not the upload: stamp to serving container was 166 s and
the whole deploy job closed in 184 s.

That run's `reason` was `prod-behind` because the decider compared shas. It now
compares the `backend/` tree and would print `backend-stale`; see the reason table
above for why the difference matters to anyone reading a green checkmark.
