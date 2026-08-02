# Observability — Sentry (errors) + OpenTelemetry (traces)

What's wired, what env each surface needs, and how to verify. Everything is
**inert until its env is set**, so nothing here affects local/dev or blocks a build.

## Status

| Surface | Errors (Sentry) | Traces (OTel) | Notes |
|---|---|---|---|
| **backend** (Go) | ✅ wired (`sentry-go` + `sentrygin`) | ✅ wired (OTel → Cloud Trace, `otelgin`) | via `internal/platform/observability` + `cmd/server` + router middleware |
| **frontend-web** (Next) | ✅ wired (`@sentry/nextjs`) | ▶ via Sentry perf tracing (`tracesSampleRate`) | `instrumentation.ts` + `sentry.*.config.ts` + `withSentryConfig` |
| **frontend-admin** (Next 15) | ⬜ pending — needs `npm i @sentry/nextjs` then mirror the web files | — | fast follow |
| **mobile** (RN/Expo) | ⬜ pending — `@sentry/react-native` + expo plugin | — | separate Sentry project + dSYM upload |

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

## Next (P1)
- Propagate trace context web → backend (single end-to-end trace per request).
- Custom business metrics via OTel (payment success, ledger-invariant guard) → Cloud Monitoring.
- Alert policies on symptoms (error rate, latency, failed payments) → PagerDuty/Slack.
- Mirror Sentry to `frontend-admin` and add `@sentry/react-native` to mobile.
