# ADR-027 — Production deploy target: Cloud Run (backend) + Vercel (web)

**Date:** 2026-08-07
**Status:** Accepted
**Deciders:** Platform team · DevOps
**Supersedes:** [ADR-026](ADR-026-free-tier-hosting.md) (free-tier Render topology, *Proposed*, never adopted)
**Scope:** The canonical deployment target for the super-app. No application code changes.

> **Amendment — 2026-08-13 (web leg only).** The Vercel half of this decision was never
> activated, and `deploy-web.yml` has been **deleted**. It never ran successfully once: its
> workflow-level `concurrency.group` referenced `matrix.app`, and `matrix` is not an available
> context outside a job, so GitHub failed the file at startup on every push — 198 jobless
> `failure` runs between 2026-08-02 and 2026-08-13, ignoring the `workflow_dispatch`-only
> trigger, because startup validation happens before trigger evaluation. Web now deploys via
> the Railway jobs in `ci.yml` (`RAILWAY_DEPLOY_ENABLED`), with `deploy-cpanel.yml` as the
> legacy path. The **backend → Cloud Run** decision below is unchanged. Reviving Vercel means
> restoring the file from git history *and* fixing the concurrency group — plus reconnecting
> the Vercel Git integration, which posts its own `Vercel` commit status independently of any
> workflow.

## Context

Two hosting paths coexisted in the tree and caused ambiguity:

- **ADR-026 + `render.yaml`** — a free-tier Render Blueprint proposed for the low-traffic
  development period. It never moved past **Proposed**.
- **`docs/launch/SUPER-APP-LAUNCH-BLUEPRINT.md` + the launch-infra harvest** (PR #42) — which
  **locked** the production topology: *Backend → Google Cloud Run, Web → Vercel, Data →
  Supabase*, with Terraform IaC (`infra/terraform/**`), OIDC/Workload-Identity auth, and the
  `deploy.yml` / `deploy-web.yml` pipelines.

`deploy.yml` already targets Cloud Run. This ADR settles the choice so there is one deploy
target of record and no drift between competing configs.

## Decision

**Cloud Run + Vercel is the deployment target.** The Render free-tier path is retired.

- **Backend (Go/Gin + workers)** → **Google Cloud Run**. `deploy.yml` builds one image and
  promotes the *same* image dev→staging→prod; auth via **Workload Identity Federation** (OIDC,
  no long-lived keys); prod gated by the GitHub `production` Environment (required reviewers).
  Rollback = re-run `deploy.yml` with `workflow_dispatch sha=<prior>`, or shift Cloud Run
  traffic to the previous revision.
- **Web (`frontend-web`, `frontend-admin`)** → **Vercel**, via `deploy-web.yml` (preview per PR,
  production alias on `main`).
- **Data/Auth** → **Supabase** (managed Postgres + Auth/RLS), unchanged.
- **IaC** → `infra/terraform/**` (Cloud Run services, monitoring, WIF).
- **`render.yaml` is removed.** The Render topology remains documented in ADR-026 and recoverable
  from git history if the free-tier path is ever revisited.

The pre-existing `deploy-cpanel.yml` (legacy cPanel/Passenger web path) is **out of scope** here
and untouched; it is orthogonal to the backend Render-vs-Cloud-Run question this ADR settles.

## Consequences

- **One deploy target of record** — no more Render-vs-Cloud-Run ambiguity or dual-config drift.
- All deploy workflows remain **safe-by-default**: they no-op until their GCP/Vercel secrets and
  the `production` Environment are configured, so this ADR is safe to land before cloud wiring.
- **Cost**: Cloud Run + Vercel are not £0 like the retired Render free tier, but scale-to-zero
  (Cloud Run min-instances 0 in dev/staging) keeps idle cost low; prod runs min-instances ≥ 1.
- **Follow-ups to activate** (tracked in `docs/launch/SUPER-APP-LAUNCH-BLUEPRINT.md` and
  `infra/terraform/README.md`): provision the GCP project + Artifact Registry, configure the WIF
  provider + deploy service account, set the per-Environment secrets/variables, and connect the
  Vercel project.

## Alternatives considered

- **Render free-tier (ADR-026)** — cheapest, but Render's free Postgres is deleted after 90 days
  (Supabase was already the DB), free web services cold-start aggressively, and it does not match
  the Terraform/observability foundation already merged. Rejected as the production target;
  retained only as documented history.
- **Stay on cPanel/Passenger** — the pre-existing prod for web; not reproducible IaC and no
  build-once→promote story for the Go backend. Superseded for the backend.
