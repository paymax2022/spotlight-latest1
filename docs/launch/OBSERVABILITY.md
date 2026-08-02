# Observability — Sentry (errors) + OpenTelemetry (traces)

What's wired, what env each surface needs, and how to verify. Everything is
**inert until its env is set**, so nothing here affects local/dev or blocks a build.

## Status

| Surface | Errors (Sentry) | Traces (OTel) | Notes |
|---|---|---|---|
| **backend** (Go) | ✅ wired (`sentry-go` + `sentrygin`) | ✅ wired (OTel → Cloud Trace, `otelgin`) | via `internal/platform/observability` + `cmd/server` + router middleware |
| **frontend-web** (Next 14) | ✅ wired (`@sentry/nextjs`) | ▶ via Sentry perf tracing (`tracesSampleRate`) | `instrumentation.ts` + `sentry.*.config.ts` + `withSentryConfig` |
| **frontend-admin** (Next 15) | ✅ wired (`@sentry/nextjs`) | ▶ via Sentry perf tracing | same file set; `SENTRY_PROJECT_ADMIN` for a separate project |
| **mobile** (RN/Expo 54) | ✅ wired (`@sentry/react-native`) | ▶ via Sentry perf tracing | `Sentry.wrap` in `app/_layout.tsx`, expo plugin, `getSentryExpoConfig` metro |

## Backend env (Cloud Run service / Secret Manager)

| Var | Purpose | Where |
|---|---|---|
| `SENTRY_DSN` | enables backend error tracking | Secret Manager (server-side) |
| `SENTRY_TRACES_SAMPLE_RATE` | perf sampling (default `0.1`) | env |
| `GOOGLE_CLOUD_PROJECT` | enables OTel → Cloud Trace | **auto-set by Cloud Run** |
| `OTEL_TRACES_SAMPLE_RATE` | trace sampling (default `0.1`) | env |
| `RELEASE` / `GIT_SHA` | release tag (else Cloud Run `K_REVISION`) | env |

- No `SENTRY_DSN` → Sentry off. No `GOOGLE_CLOUD_PROJECT` → tracing off. Both no-op locally.
- Flush on shutdown is handled in `cmd/server/main.go` (drains before the instance dies).
- Cloud Run's runtime SA already has `roles/cloudtrace.agent` (see `infra/terraform/main.tf`).

## Web env (Vercel project: frontend-web)

| Var | Public? | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | **public** (safe) | browser error tracking |
| `SENTRY_DSN` | server-only | SSR / route-handler errors |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | public | tag (preview/staging/prod) — falls back to `VERCEL_ENV` |
| `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` | public | browser perf sampling (default `0.1`) |
| `SENTRY_ORG`, `SENTRY_PROJECT` | server-only | source-map upload target |
| `SENTRY_AUTH_TOKEN` | **secret** | source-map upload (CI/Vercel env only — never `NEXT_PUBLIC_`) |

- The public DSN is expected to ship to the browser; it only permits *sending* events.
- `SENTRY_AUTH_TOKEN` is the only secret — it stays server-side, so the CI
  `secret-hygiene` check stays green.
- Session Replay is **off**; if enabled, masks are forced on (no card/OTP/PII capture).

## Admin env (Vercel project: frontend-admin)

Same as web, with its own Sentry project. Use `SENTRY_PROJECT_ADMIN` (falls back to
`SENTRY_PROJECT`) so admin errors are separated from the consumer web app. Session
Replay stays off (admin sees the most sensitive data).

## Mobile env (EAS / app config)

| Var | Purpose |
|---|---|
| `EXPO_PUBLIC_SENTRY_DSN` | enables mobile error + native-crash capture (public DSN) |
| `EXPO_PUBLIC_SENTRY_ENVIRONMENT` | tag (dev/staging/prod) |
| `EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` | perf sampling (default `0.1`) |

- Wired via `Sentry.wrap()` in `app/_layout.tsx`; the `@sentry/react-native` Expo
  config plugin + `getSentryExpoConfig` metro config handle native + source maps.
- Native crash capture needs a **dev build or EAS build** (not Expo Go). JS errors
  work everywhere.
- For source-map upload on EAS, set `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN`
  in EAS secrets and add the org/project to the plugin config when you set up EAS.

## Distributed tracing — web → backend (one trace)

End-to-end tracing is wired:
- **Browser** (`@sentry/nextjs`, web + admin): `tracePropagationTargets` attaches trace
  headers (`sentry-trace`/`baggage`) to same-origin `/api` calls (+ `NEXT_PUBLIC_API_BASE_URL` if set).
- **Next gateway** (`proxyToGoBackend`): forwards `traceparent`/`tracestate`/`sentry-trace`/`baggage`
  to Go so the trace survives the proxy (previously dropped there).
- **Backend**: W3C propagator set in `observability.Init`, so `otelgin` continues the
  incoming trace; `sentrygin` continues the Sentry trace (backend tracing on).

## Business metrics (OTel → Cloud Monitoring)

`internal/platform/metrics` exposes drop-in counters, no-op until the meter provider
is configured (auto on when `GOOGLE_CLOUD_PROJECT` is set):
- `RecordPaymentResult(ctx, provider, success)` — payment success/failure rate
- `RecordMoneyMovement(ctx, type, result)` — fund/transfer/payout volumes
- `RecordLedgerInvariantBreach(ctx, kind)` — **must stay 0**; alert on it

> These are the API; add the calls at the natural money-path decision points
> (charge/verify resolve, movement completion, ledger check failure). No finance
> internals were edited here to respect the brownfield boundary.

## Alerts & uptime (Cloud Monitoring — Terraform)

`infra/terraform/monitoring.tf` provisions:
- **Uptime checks**: external HTTPS check on backend `/healthz` (60s); optional web check (`web_uptime_host`).
- **Alert policies**: backend **down** (uptime failing), **5xx rate** (`alert_5xx_per_min`, default 5/min), **p95 latency** (`alert_latency_p95_ms`, default 800ms), and optional web-down.
- **Notification channels** (alerts route to all that are set):
  - `alert_notification_email` → email
  - `slack_channel` + `slack_auth_token` → Slack (needs the GCP Monitoring Slack app authorized)
  - `pagerduty_webhook_url` → PagerDuty/Opsgenie/webhook (pass via `TF_VAR_pagerduty_webhook_url`)
- With no channel set, uptime checks still run but no alert policies are created.

## Verify

**Backend (staging):**
```bash
# healthz/readyz already smoke-tested by deploy.yml. To confirm tracing:
# 1. set SENTRY_DSN + (Cloud Run auto) GOOGLE_CLOUD_PROJECT
# 2. hit an endpoint, then check Cloud Trace console for a "paymax-backend" trace
# 3. trigger a test error and confirm it lands in the backend Sentry project
```

**Web (preview/staging):**
```bash
# 1. set NEXT_PUBLIC_SENTRY_DSN in the Vercel project
# 2. throw a test error in a page/route; confirm it appears in the web Sentry project
# 3. confirm the release = commit SHA and environment tag are correct
```

## Done
- ✅ Sentry on backend, web, admin, mobile.
- ✅ OTel traces (backend → Cloud Trace) + web→backend trace-context propagation.
- ✅ Business-metrics API (`internal/platform/metrics`) → Cloud Monitoring.
- ✅ Uptime checks + symptom alert policies → email / Slack / PagerDuty channels.
- ✅ Golden-signals dashboard (`infra/terraform/dashboard.tf`).
- ✅ Mobile release pipeline (`eas.json` + `.github/workflows/mobile-eas.yml`).
- ✅ Money-path load test (`infra/loadtest/money-path.js`, k6; thresholds = SLOs).

## Next (P2)
- Add the `metrics.Record*` calls at the money-path decision points (finance-owner review).
- Real bundle IDs (replace `com.anonymous.*`) + `eas init`; EAS source-map upload secrets.
- SLO objects + burn-rate alerts (multi-window) once a baseline exists.
- Run the k6 load test against staging; tune Cloud Run min/max instances.
