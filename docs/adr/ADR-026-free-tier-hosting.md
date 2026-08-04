# ADR-026 — Free-tier hosting topology for the development period

**Date:** 2026-08-04
**Status:** Proposed
**Deciders:** Platform team · DevOps
**Scope:** How the super-app is hosted while traffic is low and cost must be ~£0.
Artifacts: `render.yaml` (Blueprint) and `.github/workflows/deploy.yml` (deploy pipeline).
No application code changes.

## Context

Prod today is cPanel/Passenger, and `deploy.yml` was `echo TODO` stubs (per the
Phase-1 audit). We want a real, reproducible, **free** hosting setup for dev/testing
that we can grow off later without re-architecture. The stack:

- **Go API** — `backend/` (Gin), multi-binary Docker: `cmd/server` (the API) plus
  workers `marketplace-cron`, `marketplace-indexer`, `transport-scheduler`.
- **Two Next.js apps** — `frontend-web` (14) and `frontend-admin` (15). Note:
  `frontend-web`'s `npm start` is plain `next start` (the cPanel `server.js` is not
  required off Passenger), so standard Node hosting works.
- **Postgres + Auth** — Supabase (already used for Auth/RLS + ~291 migrations).
- **Redis** — idempotency cache, Redlock, asynq queue.
- **Object storage** — Cloudflare R2 (S3-compatible). **Email** — Resend. **Payments**
  — Paystack. **Search** — Elasticsearch. **Routing** — OSRM (transport module).

Key constraint discovered: **ES and OSRM have no honest free tier** (both want ~1GB+
RAM), and **Render's free tier has no always-on background workers or cron**, only Web
Services and Key Value. Both ES and the transport/maps corridors are already
**feature-flagged** (`ELASTICSEARCH_URL`, `FEATURE_MAPS_ENABLED`,
`FEATURE_TRANSPORT_ENABLED`), so they can be turned off in dev with safe fallbacks
(Postgres search; haversine distance).

## Decision

Host on a **small free hybrid** — best-of-breed free tier per component — rather than
forcing everything onto one platform. Primary platform is **Render** for the
request-serving processes + Redis; the database stays on **Supabase**.

| Component | Free host | Notes |
|---|---|---|
| Go API (`cmd/server`) | **Render Web Service** (Docker, `backend/Dockerfile`) | 512MB; spins down after 15min idle → cold start |
| `frontend-web` (Next 14) | **Render Web Service** (Node) | `next start` binds `$PORT` |
| `frontend-admin` (Next 15) | **Render Web Service** (Node) | start overridden to `next start -p $PORT` (package.json hardcodes 3001) |
| Postgres + Auth | **Supabase free** | keep-alive to avoid the 7-day idle pause |
| Redis | **Render Key Value** (free, 25MB) | `maxmemoryPolicy: noeviction`; Upstash free is an equal alternative |
| Object storage | **Cloudflare R2 free** | 10GB, no egress fees |
| Email | **Resend free** | 3k/mo |
| Payments | Paystack test keys | — |
| Search (ES) | **disabled** (`ELASTICSEARCH_URL=""`) → Postgres fallback | no free ES; enable Bonsai/Elastic Cloud later |
| Routing (OSRM) | **disabled** (`FEATURE_TRANSPORT_ENABLED=false`) → haversine | OSRM needs GBs RAM + map data |
| Workers (cron/indexer/scheduler) | **not free on Render** — run in-process (dev) or external cron | see "Consequences" |
| Mobile (RN/Expo) | Expo EAS free / Expo Go | distributed, not hosted |

**Why the DB is NOT on Render:** the app depends on Supabase **Auth** (managed JWT) +
RLS, and Render's free Postgres is **deleted after 90 days**. Supabase free is
persistent (pauses, doesn't delete) and already our source of truth.

**Why not "everything on one PaaS":** Render free has no workers/cron; Vercel is
serverless (best for the Next apps but not the Go API/workers); the DB belongs on
Supabase. A hybrid keeps every piece on a tier that is genuinely free *and* fit for
purpose.

## Consequences

**Positive**
- ~£0/month for the whole dev environment; reproducible via `render.yaml` (one-click
  Blueprint) + a real `deploy.yml` (migrate → deploy hooks → smoke).
- Uses the existing `backend/Dockerfile` and standard `next build/start` — no code
  changes; ES/OSRM stay off behind flags with working fallbacks.
- Clean graduation path (below) with no re-architecture.

**Negative / caveats**
- **Cold starts (15-min spin-down)** hurt latency and webhooks. Paystack **retries**,
  so events aren't lost, but delivery can be delayed. Mitigation: a free keep-alive
  ping (UptimeRobot / cron-job.org) hitting `/api/v1/public/health` every ~10 min; the
  same ping keeps Supabase from pausing.
- **Background workers don't run on Render free.** For dev, either (a) run the
  cron/indexer/scheduler as goroutines inside `server` (behind a
  `RUN_WORKERS_INPROCESS` flag), or (b) trigger their entrypoints via a free external
  cron hitting an admin endpoint. **Neither is production-grade** — promote them to
  paid Render Background Workers when off free tier.
- **Redis free (25MB, noeviction)** is fine for dev idempotency/queue volumes but will
  fill under real load — size up or move to Upstash/managed Redis before launch.
- Search + routing features are dark in dev (acceptable; both are non-core to money).

## Graduation path (off free tier, no re-architecture)

1. Flip the three Render Web Services to a paid plan → **no spin-down**, more RAM.
2. Promote `cron/indexer/scheduler` to **paid Render Background Workers** (same Docker
   image, different `startCommand`).
3. Turn search back on (`ELASTICSEARCH_URL` → Bonsai/Elastic Cloud) and routing
   (`FEATURE_TRANSPORT_ENABLED=true` + a small always-on OSRM VM, or a Maps provider
   key via `MAPS_PROVIDER`).
4. Move Redis to a paid tier / Upstash pay-as-you-go.
5. Keep Supabase (upgrade the plan) or migrate Postgres to a managed instance.
6. Re-introduce the staging→prod split (this ADR runs a single free environment); the
   `deploy.yml` structure already anticipates promotion by SHA.

## Alternatives considered

- **Everything on Render (incl. Postgres).** Rejected: free Postgres is deleted at 90
  days and we'd lose Supabase Auth.
- **Railway (all-in-one: services + workers + cron + PG + Redis, no spin-down).**
  Strong DX, but its free tier is a limited monthly credit (~$5) rather than a true
  free tier — better as the *first paid* step than the free baseline.
- **Fly.io / Koyeb** for the Go API (scale-to-zero, Docker-native) — good alternatives;
  Render chosen for the simplest Blueprint + Key Value in one place.
- **Vercel/Netlify** for the Next apps — best Next DX; can be adopted for
  `frontend-web`/`admin` independently of the Go API if cold starts on Render annoy.

## Non-goals

Production hardening (autoscaling, blue/green, observability/otel, WAF), multi-region,
and the ES/OSRM production topology are out of scope until traffic warrants paid tiers.
