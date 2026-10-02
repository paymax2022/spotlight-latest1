# ADR-PR421 — Single deployment authority per service (proposed)

- **Status:** Proposed — needs owner ratification, then quarantine PRs
- **Context finding:** AUD-INFRA-003 (fragmented deployment authority)
- **Deciders:** platform owner

## Context

Four deploy surfaces coexist with no declared authority:

| Target | File | What it owns |
|---|---|---|
| Cloud Run (GitHub Actions) | `.github/workflows/deploy.yml` | backend image built once → promoted dev→staging→prod; WIF auth (no long-lived keys); prod human-gated; rollback via `workflow_dispatch sha=` + traffic shift |
| Render blueprint | `render.yaml` | `spotlight-backend` web + 4 workers + Postgres + Redis + frontend-web + mobile-web; `autoDeploy: true` |
| Railway | `backend/railway.json`, `frontend-web/railway.json`, `frontend-admin/railway.json` | thin service stubs |
| cPanel Passenger | `frontend-web/server.js`, `deploy-cpanel.yml` | frontend-web at the apex domain (`www.spotlightng.com` is what `eas.json`/mobile point at) |

Two of these can ship the same service on the same push — `deploy.yml` and
`render.yaml` both build `spotlight-backend` from `Dockerfile` — so a merge can
race two different runtimes with no single source of truth for "what is live".

## Decision (proposed)

One authority per service:

- **Go backend (HTTP) → Cloud Run via `deploy.yml`.** It is the only pipeline
  with build-once/promote, OIDC auth, human-gated prod, and a documented
  rollback path.
- **Backend workers/schedulers → Cloud Run Jobs** (same image, alternate
  entrypoint: `notification-worker`, `marketplace-cron`, `marketplace-indexer`,
  `transport-scheduler`). Keeps every Go artifact in one registry/pipeline;
  Render's worker declarations become reference-only until deleted.
- **frontend-web → keep cPanel Passenger** if `www.spotlightng.com` is served
  from cPanel today (production DNS is the evidence — whichever target
  currently serves the apex wins by default; flipping it is a migration, not
  an authority decision).
- **frontend-admin → pick one** (Vercel/Netlify/Railway — it has no
  deploy.yml lane); whichever is live today is the authority.
- **Render/Railway → quarantine**: remove `autoDeploy`, then delete
  `render.yaml`/`railway.json` once the corresponding services are confirmed
  served by the declared authority.

## Consequences

**Positive**
- A merge can no longer race two deploys of the same service.
- Rollback has one documented path per service.
- The 4 workers get a deployment target that shares the backend's gate.

**Negative / open questions**
- Moving workers to Cloud Run Jobs needs small per-worker
  `gcloud run jobs` + trigger config (scheduler cron) — one-time infra work.
- If production `www.spotlightng.com` is actually served by Railway/Render
  rather than cPanel, ratify the observed authority instead — the rule is
  "one authority per service", not a specific host.
- Mobile web (`spotlight-mobile` Expo web) needs its own line item once its
  host is confirmed.

## Ratification checklist

1. Owner confirms which host serves each service today (DNS + deploy logs).
2. Ratify this ADR as Accepted, editing the per-service table if reality
   differs.
3. Follow-up PRs: remove `autoDeploy`/delete non-authoritative config files;
   add Cloud Run Job manifests for the 4 workers.
4. Update `docs/full_audit.md` AUD-INFRA-003 → RESOLVED.
