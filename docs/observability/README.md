# Observability — Paymax × Spotlight

> Owner: DevOps / SRE. Satisfies RELEASE_READINESS_CHECKLIST §5
> ("Observability dashboard + alerts for authz failures/security spikes").
> Everything here is **dashboards-as-code + alert rules**. Nothing in this
> directory deploys anything or enables a feature. It is review-gated config.

## What exists in the repo today

| Pillar | Source | Notes |
|---|---|---|
| Error tracking | `frontend-web/src/lib/sentry.ts` (`@sentry/nextjs`) | DSN via `SENTRY_DSN`, enabled in `production` only |
| Structured logs | `pino` in frontend-web; Go `slog`-style logging in backend | JSON logs; ship to your log backend |
| Security/audit events | Go backend emits `security_event` / audit events; RBAC `RequirePermission` denials | Surfaced via DB tables + logs |
| Metrics | **none wired yet** | This is the gap these configs close |

There is **no single metrics/alerting stack chosen** in the repo. These configs
are therefore **provider-agnostic**: a Prometheus-style rules file (works with
Prometheus / Grafana Alerting / VictoriaMetrics / Grafana Cloud / Mimir), a
Grafana dashboard JSON, and a Sentry-alerts mapping for teams that only run
Sentry today. Pick the stack you operate and wire the matching file; delete the
others.

## Files

| File | Stack | Purpose |
|---|---|---|
| `alerts/money-path.rules.yml` | Prometheus / Grafana Alerting | Symptom-based alerts (RELEASE_READINESS §5) |
| `alerts/sentry-alerts.md` | Sentry | Equivalent alert rules expressed as Sentry metric/issue alerts |
| `dashboards/money-path.dashboard.json` | Grafana | One dashboard, golden signals per money surface |
| `metrics-contract.md` | any | The metric names/labels the app must emit for these alerts to fire |

## How to use

1. Decide the stack (Prometheus+Grafana, Grafana Cloud, or Sentry-only for MVP).
2. Make the application emit the metrics in `metrics-contract.md`. **The alerts
   are inert until the app emits these series.** This is application work owned by
   the module teams, not DevOps; tracked as a follow-up — see "Unmet
   dependencies" below.
3. Import `dashboards/money-path.dashboard.json` into Grafana (or load via
   Grafana provisioning / Terraform `grafana_dashboard`).
4. Load `alerts/money-path.rules.yml` into your rule evaluator.
5. Point alert routes at the on-call rotation (PagerDuty/Opsgenie/Slack). Every
   alert below has a documented owner and a linked runbook.

## Alerts (symptoms users feel — RELEASE_READINESS §5)

| Alert | Fires on | Severity | Runbook |
|---|---|---|---|
| AuthzFailureSpike | authorization-denied rate ≫ baseline | page | `../runbooks/incident-rollback.md` |
| SecurityEventSpike | `security_event` emission rate spike | page | `../runbooks/incident-rollback.md` |
| PermissionDeniedRateHigh | sustained 403 rate on admin/finance surfaces | warn→page | `../runbooks/incident-rollback.md` |
| MoneyPathErrorRate | 5xx / error ratio on wallet/transfer/ledger routes | page | `../runbooks/incident-rollback.md` |
| WebhookFailureRate | Paystack webhook processing failures / DLQ growth | page | `../runbooks/incident-rollback.md` |
| LedgerInvariantDrift | ledger debit≠credit or wallet≠ledger projection | page (P0) | `../runbooks/incident-rollback.md` |

All thresholds are **starting points**; tune against one week of staging
baseline before relying on them in prod.

## Unmet dependencies (do not skip before fintech GA)

- The app does not yet expose a Prometheus `/metrics` endpoint or emit the
  series in `metrics-contract.md`. Until it does, these alerts cannot fire and
  the Grafana panels are empty. This is the single biggest observability gap.
- `LedgerInvariantDrift` and `WebhookFailureRate` depend on jobs that the
  background-jobs audit (`docs/audit/04-background-jobs.md`) lists as **not yet
  built** (ledger invariant checker, webhook DLQ/retry). The alerts are wired in
  advance so they activate the moment those jobs ship.
